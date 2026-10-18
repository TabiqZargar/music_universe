"use client";

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onError: () => void;
}

export class SceneErrorBoundary extends Component<Props> {
  override componentDidCatch() {
    this.props.onError();
  }

  override render() {
    return this.props.children;
  }
}
