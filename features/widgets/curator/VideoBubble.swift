// ─────────── VideoBubble.swift (FULL FILE) ───────────

import SwiftUI
import WebKit
import SafariServices
import UIKit

// ─────────── Section Header ───────────
// In-app Safari wrapper
private struct SafariSheet: UIViewControllerRepresentable {
	let url: URL
	func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
	func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

// ─────────── Section Header ───────────
// WKWebView that flags load failure
private struct YouTubeWebView: UIViewRepresentable {
	let embedURL: URL
	@Binding var failed: Bool
	
	final class Coordinator: NSObject, WKNavigationDelegate {
		@Binding var failed: Bool
		init(_ failed: Binding<Bool>) { _failed = failed }
		func webView(_ webView: WKWebView, didFail navigation: WKNavigation!,            withError error: Error) { failed = true }
		func webView(_ webView: WKWebView, didFailProvisionalNavigation nav: WKNavigation!, withError error: Error) { failed = true }
	}
	
	func makeCoordinator() -> Coordinator { Coordinator($failed) }
	
	func makeUIView(context: Context) -> WKWebView {
		let cfg = WKWebViewConfiguration()
		cfg.allowsInlineMediaPlayback = true
		cfg.mediaTypesRequiringUserActionForPlayback = []
		
		let web = WKWebView(frame: .zero, configuration: cfg)
		web.navigationDelegate = context.coordinator
		web.scrollView.isScrollEnabled = false
		web.backgroundColor = .clear
		web.isOpaque = false
		return web
	}
	
	func updateUIView(_ uiView: WKWebView, context: Context) {
		guard !failed else { return }
		uiView.load(URLRequest(url: embedURL))
	}
}

// ─────────── Section Header ───────────
// Bubble view
struct VideoBubble: View {
	let video: Video
	
	@State private var embedFailed = false
	@State private var showSafari  = false
	@State private var showPlayer  = false
	
	@Environment(\.colorScheme) private var colorScheme
	
	private var linkOnly: Bool { !video.embeddable }
	
	var body: some View {
		VStack(spacing: 0) {
			if showPlayer && !embedFailed && !linkOnly {
				YouTubeWebView(embedURL: embedURL, failed: $embedFailed)
					.frame(height: 200)
					.cornerRadius(10)
			} else {
				thumbnail
					.overlay(overlayContent, alignment: .center)
				// Only add tap-to-play when we *can* embed
					.onTapGesture { if !linkOnly && !embedFailed { showPlayer = true } }
			}
		}
		.background(Color(.systemBackground).opacity(0.7))
		.cornerRadius(10)
		.padding(.vertical, 8)
		.sheet(isPresented: $showSafari) {
			SafariSheet(url: video.videoURL).edgesIgnoringSafeArea(.all)
		}
	}
	
	// ─────────── Thumbnail
	private var thumbnail: some View {
		AsyncImage(url: video.thumbnailURL) { img in
			img.resizable().scaledToFill()
		} placeholder: {
			Color.gray.opacity(0.3)
		}
		.frame(height: 200)
		.clipped()
		.cornerRadius(10)
	}
	
	// ─────────── Overlay
	@ViewBuilder
	private var overlayContent: some View {
		if linkOnly || embedFailed {
			// ❶ A spacer the size of the bubble keeps the button’s frame “real”
			Color.clear
				.overlay(
					Button(action: openExternally) {
						HStack(spacing: 6) {
							Image(systemName: "play.circle.fill")
								.foregroundColor(colorScheme == .light ? .black : .white)
							Text("Watch on YouTube")
						}
						.font(.headline)
						.padding(.horizontal, 20)
						.padding(.vertical, 10)
						.background(Color(.systemBackground).opacity(0.7))
						.cornerRadius(25)
					}
						.contentShape(Rectangle())    // ❷ Ensures the whole pill is tappable
				)
				.allowsHitTesting(true)           // ❸ Bubble image no longer steals taps
				.zIndex(1)                        // ❹ Always above the thumbnail
		} else {
			Image(systemName: "play.fill")
				.font(.system(size: 50))
				.foregroundColor(colorScheme == .light ? .white : .black)
				.opacity(0.8)
		}
	}
	
	// ─────────── External open
	private func openExternally() {
		// Try YouTube app first; if check is blocked by privacy, jump straight to Safari sheet
		let appURL  = URL(string: "youtube://watch?v=\(video.id)")!
		if UIApplication.shared.canOpenURL(appURL) {
			UIApplication.shared.open(appURL)
		} else {
			showSafari = true
		}
	}
	
	// ─────────── Helper
	private var embedURL: URL {
		URL(string: "https://www.youtube-nocookie.com/embed/\(video.id)?playsinline=1")!
	}
}
