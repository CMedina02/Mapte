#!/usr/bin/env bash
# Genera el DEM, la ortofoto, los metadatos y las sumas SHA-256 de Monte Sharp.
# Desde backend/: bash scripts/terrain/build_gale_mount_sharp.sh
# Requiere GDAL 3.6+, curl y Python con Pydantic.
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

# Proyección transversa de Mercator sobre la esfera Mars 2000.
# Sector local de [0, SIZE_M] × [0, SIZE_M], centrado en 4.75° S y 137.40° E.
CENTER_LAT=-4.75
CENTER_LON=137.4
SIZE_M=10000
LOCAL="+proj=tmerc +lat_0=${CENTER_LAT} +lon_0=${CENTER_LON} +k=1 +x_0=$((SIZE_M / 2)) +y_0=$((SIZE_M / 2)) +R=3396190 +units=m +no_defs"
DEM_RES_M=4      # 2500 × 2500 muestras Float32, 25 MB.
TEX_RES_M=2
MARGIN_M=100     # Margen de recorte para evitar huecos al reproyectar.

DEM_URL="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_DEM_Mosaic_1m_v3.tif"
DEM_BYTES=3868256546
ORTHO_URL="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/MSL/MSL_Gale_Orthophoto_Mosaic_25cm_v3.tif"

export GDAL_HTTP_MULTIRANGE=PARALLEL GDAL_HTTP_MERGE_CONSECUTIVE_RANGES=YES
export GDAL_HTTP_MULTIPLEX=YES GDAL_HTTP_VERSION=2
# Limita la opción a /vsicurl/ para que ENVI encuentre su cabecera local.
REMOTE_ENV=(env GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR)
export CPL_VSIL_CURL_CHUNK_SIZE=10485760 GDAL_CACHEMAX=2048
export GDAL_HTTP_MAX_RETRY=5 GDAL_HTTP_RETRY_DELAY=2

mkdir -p "$R/raw" "$R/work" "$R/derived"
cd "$R"

step() { printf '\n==> %s\n' "$*"; }

# Descarga el DEM completo: las tiras LZW de una fila encarecen el recorte remoto.
DEM_RAW="raw/MSL_Gale_DEM_Mosaic_1m_v3.tif"
if [[ "$(stat -c %s "$DEM_RAW" 2>/dev/null || echo 0)" != "$DEM_BYTES" ]]; then
  step "Descargando DEM 1 m (3.9 GB, reanudable)"
  curl -L --fail --retry 5 -C - -o "$DEM_RAW" "$DEM_URL"
fi

# Recorta la ortofoto a 25 cm antes de reproyectar.
# gdalwarp sobre /vsicurl/ solicita teselas individuales.
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

# Reproyecta el DEM y convierte NoData (-32767) a NaN.
step "DEM -> heightmap ${DEM_RES_M} m"
gdalwarp -q -overwrite "$DEM_RAW" "work/dem_${DEM_RES_M}m.tif" \
  -t_srs "$LOCAL" -te 0 0 "$SIZE_M" "$SIZE_M" -tr "$DEM_RES_M" "$DEM_RES_M" \
  -r average -srcnodata -32767 -dstnodata nan -ot Float32 \
  -multi -wo NUM_THREADS=ALL_CPUS -co TILED=YES -co COMPRESS=DEFLATE -co PREDICTOR=3
# ENVI escribe el binario en el orden de bytes nativo.
gdal_translate -q -of ENVI -ot Float32 "work/dem_${DEM_RES_M}m.tif" "work/heightmap.envi"
mv "work/heightmap.envi" "derived/heightmap_${DEM_RES_M}m.f32"
rm -f work/heightmap.hdr work/heightmap.envi.aux.xml

# Reproyecta el recorte local y exporta la ortofoto como PNG.
step "Ortofoto -> textura ${TEX_RES_M} m"
gdalwarp -q -overwrite "$ORTHO_CROP" "work/ortho_${TEX_RES_M}m.tif" \
  -t_srs "$LOCAL" -te 0 0 "$SIZE_M" "$SIZE_M" -tr "$TEX_RES_M" "$TEX_RES_M" \
  -r average -srcnodata 0 -dstnodata 0 \
  -multi -wo NUM_THREADS=ALL_CPUS -co TILED=YES -co COMPRESS=DEFLATE
# Un píxel 0 indica falta de cobertura HiRISE en el mosaico.
gdal_translate -q -of PNG -co ZLEVEL=9 "work/ortho_${TEX_RES_M}m.tif" "derived/ortho_${TEX_RES_M}m.png"
rm -f "derived/ortho_${TEX_RES_M}m.png.aux.xml"

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
