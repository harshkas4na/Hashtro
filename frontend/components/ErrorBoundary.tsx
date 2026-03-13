"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

/**
 * React Error Boundary that catches render errors and shows a recovery UI
 * instead of a blank white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
	constructor(props: Props) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, info: ErrorInfo) {
		console.error("ErrorBoundary caught:", error, info.componentStack);
	}

	render() {
		if (this.state.hasError) {
			if (this.props.fallback) return this.props.fallback;

			return (
				<section className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0f] text-white px-4">
					<div className="card-glass text-center max-w-md">
						<h2 className="font-display text-2xl font-semibold mb-4 text-red-400">
							Cosmic Disruption
						</h2>
						<p className="text-white/50 mb-6">
							Something unexpected happened in the cosmos. Please refresh the
							page to try again.
						</p>
						<button
							onClick={() => window.location.reload()}
							className="btn-primary w-full"
							type="button"
						>
							Refresh Page
						</button>
					</div>
				</section>
			);
		}

		return this.props.children;
	}
}
