#!/usr/bin/env bash
# D02 — Pipeline repetible del terreno de Monte Sharp (cráter Gale, MC-23).
#
# Genera en data/regions/mc23-gale-mount-sharp/derived/ los activos que sí se commitean:
#   heightmap_4m.f32  DEM 4 m, float32 LE, row-major norte->sur, NoData = NaN (contrato C02)
#   ortho_2m.png      Ortofoto gris 8 bit a 2 m, alineada al mismo AOI
#   terrain.json      Metadata del contrato + transformaciones + procedencia + checksums
#   SHA256SUMS
#
# raw/ y work/ quedan fuera de git (ver backend/.gitignore).
#
# Uso (desde backend/):  bash scripts/terrain/build_gale_mount_sharp.sh
# Requiere: GDAL >= 3.6 (gdalwarp, gdal_translate, gdaltransform), curl, python3 + pydantic.
set -euo pipefail

REGION_ID="mc23-gale-mount-sharp"
REGION_NAME="Monte Sharp (Aeolis Mons), cráter Gale"
REGION_DESCRIPTION="AOI de 10 km en Monte Sharp, cráter Gale, cuadrángulo Aeolis (MC-23), Marte"
# Zonas de calidad (zone_id:quality:x_min:x_max:y_min:y_max:motivo), en metros del marco local.
QUALITY_ZONES=(
  "east-dem-grid-artifacts:unknown:6600:10000:0:10000:Artefactos en rejilla del DEM USGS (relleno de menor resolución); pendientes no fiables"
)
BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
R="$BACKEND_DIR/data/regions/$REGION_ID"

# Marco local: Transversa de Mercator sobre la esfera Mars 2000 (R = 3 396 190 m),
# centrada en el AOI (-4.75, 137.40 E). El AOI ocupa [0, SIZE_M] x [0, SIZE_M].
CENTER_LAT=-4.75
CENTER_LON=137.4
SIZE_M=10000
LOCAL="+proj=tmerc +lat_0=${CENTER_LAT} +lon_0=${CENTER_LON} +k=1 +x_0=$((SIZE_M / 2)) +y_0=$((SIZE_M / 2)) +R=3396190 +units=m +no_defs"
DEM_RES_M=4      # 2500 x 2500 -> 25 MB (.f32 sin compresión; < 50 MB para GitHub)
TEX_RES_M=2      # 5000 x 5000 PNG
MARGIN_M=100     # margen del recorte nativo para que el warp no deje bordes vacíos

DEM_URL="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
DEM_BYTES=3868256546
ORTHO_URL="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif"

# Lectura remota eficiente: agrupa rangos HTTP contiguos y los pide en paralelo.
export GDAL_HTTP_MULTIRANGE=PARALLEL GDAL_HTTP_MERGE_CONSECUTIVE_RANGES=YES
export GDAL_HTTP_MULTIPLEX=YES GDAL_HTTP_VERSION=2
# Solo para /vsicurl/: evita listar el bucket. En local rompe el driver ENVI (no halla el .hdr).
REMOTE_ENV=(env GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR)
export CPL_VSIL_CURL_CHUNK_SIZE=10485760 GDAL_CACHEMAX=2048
export GDAL_HTTP_MAX_RETRY=5 GDAL_HTTP_RETRY_DELAY=2

mkdir -p "$R/raw" "$R/work" "$R/derived"
cd "$R"

step() { printf '\n==> %s\n' "$*"; }

# 1. DEM completo (1 m, LZW en tiras de 1 fila: recortar en remoto es ineficiente).
DEM_RAW="raw/MSL_Gale_DEM_Mosaic_1m_v3.tif"
if [[ "$(stat -c %s "$DEM_RAW" 2>/dev/null || echo 0)" != "$DEM_BYTES" ]]; then
  step "Descargando DEM 1 m (3.9 GB, reanudable)"
  curl -L --fail --retry 5 -C - -o "$DEM_RAW" "$DEM_URL"
fi

# 2-3. Ortofoto (24 GB remota, teselas de 128 px): VRT gris + recorte nativo 0.25 m local.
#    NO usar gdalwarp directo sobre /vsicurl/: pide teselas sueltas y se queda en 0 % horas.
#    Solo toca la red si el recorte local no existe o está corrupto.
ORTHO_CROP="work/ortho_025m_crop.tif"
if [[ ! -s "$ORTHO_CROP" ]] || ! gdalinfo "$ORTHO_CROP" >/dev/null 2>&1; then
  step "VRT gris de la ortofoto remota"
  "${REMOTE_ENV[@]}" gdal_translate -q -of VRT -expand gray "/vsicurl/$ORTHO_URL" work/ortho_gray.vrt
  step "Calculando ventana nativa del AOI"
  NATIVE_WKT="work/ortho_native.wkt"
  gdalsrsinfo -o wkt work/ortho_gray.vrt > "$NATIVE_WKT"
  lo=$((-MARGIN_M)); hi=$((SIZE_M + MARGIN_M)); mid=$((SIZE_M / 2))
  read -r XMIN XMAX YMIN YMAX < <(
    printf '%s\n' "$lo $lo" "$hi $lo" "$lo $hi" "$hi $hi" "$mid $lo" "$mid $hi" "$lo $mid" "$hi $mid" |
      gdaltransform -s_srs "$LOCAL" -t_srs "$NATIVE_WKT" -output_xy |
      awk 'NR==1{a=c=$1;b=d=$2} {if($1<a)a=$1; if($1>c)c=$1; if($2<b)b=$2; if($2>d)d=$2}
           END{printf "%d %d %d %d\n", a-1, c+1, b-1, d+1}'
  )
  step "Descargando recorte nativo 0.25 m ($XMIN $YMAX $XMAX $YMIN)"
  rm -f "$ORTHO_CROP"
  "${REMOTE_ENV[@]}" gdal_translate "work/ortho_gray.vrt" "$ORTHO_CROP.part" \
    -projwin "$XMIN" "$YMAX" "$XMAX" "$YMIN" \
    -co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 \
    -co COMPRESS=DEFLATE -co PREDICTOR=2 -co BIGTIFF=YES -co NUM_THREADS=ALL_CPUS
  mv "$ORTHO_CROP.part" "$ORTHO_CROP"
fi

# 4. Heightmap: DEM -> marco local, promedio a DEM_RES_M, NoData -32767 -> NaN.
step "DEM -> heightmap ${DEM_RES_M} m"
gdalwarp -q -overwrite "$DEM_RAW" "work/dem_${DEM_RES_M}m.tif" \
  -t_srs "$LOCAL" -te 0 0 "$SIZE_M" "$SIZE_M" -tr "$DEM_RES_M" "$DEM_RES_M" \
  -r average -srcnodata -32767 -dstnodata nan -ot Float32 \
  -multi -wo NUM_THREADS=ALL_CPUS -co TILED=YES -co COMPRESS=DEFLATE -co PREDICTOR=3
# ENVI = binario crudo sin cabecera, orden de bytes nativo (little endian en x86/ARM).
gdal_translate -q -of ENVI -ot Float32 "work/dem_${DEM_RES_M}m.tif" "work/heightmap.envi"
mv "work/heightmap.envi" "derived/heightmap_${DEM_RES_M}m.f32"
rm -f work/heightmap.hdr work/heightmap.envi.aux.xml

# 5. Textura: recorte local -> marco local a TEX_RES_M -> PNG.
step "Ortofoto -> textura ${TEX_RES_M} m"
gdalwarp -q -overwrite "$ORTHO_CROP" "work/ortho_${TEX_RES_M}m.tif" \
  -t_srs "$LOCAL" -te 0 0 "$SIZE_M" "$SIZE_M" -tr "$TEX_RES_M" "$TEX_RES_M" \
  -r average -srcnodata 0 -dstnodata 0 \
  -multi -wo NUM_THREADS=ALL_CPUS -co TILED=YES -co COMPRESS=DEFLATE
# 0 = sin cobertura HiRISE en el mosaico USGS (huecos reales del producto, no de descarga).
gdal_translate -q -of PNG -co ZLEVEL=9 "work/ortho_${TEX_RES_M}m.tif" "derived/ortho_${TEX_RES_M}m.png"
rm -f "derived/ortho_${TEX_RES_M}m.png.aux.xml"

# 6. Metadata validada contra el contrato del dominio + checksums.
step "terrain.json y SHA256SUMS"
cd "$BACKEND_DIR"
PYTHONPATH="$BACKEND_DIR" python3 scripts/terrain/write_terrain_metadata.py \
  --region-dir "$R" --region-id "$REGION_ID" \
  --region-name "$REGION_NAME" --region-description "$REGION_DESCRIPTION" \
  "${QUALITY_ZONES[@]/#/--quality-zone=}" \
  --heightmap "heightmap_${DEM_RES_M}m.f32" --heightmap-res "$DEM_RES_M" \
  --texture "ortho_${TEX_RES_M}m.png" --texture-res "$TEX_RES_M" \
  --size-m "$SIZE_M" --local-crs "$LOCAL" \
  --dem-raw "$R/$DEM_RAW" --dem-url "$DEM_URL" --ortho-url "$ORTHO_URL"

step "Listo: $R/derived"
