import { Component, type ReactNode } from 'react';

// Si un hijo falla al renderizar (p. ej. el navegador no soporta WebGL), muestra el respaldo
export default class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('Vista reemplazada por respaldo:', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
