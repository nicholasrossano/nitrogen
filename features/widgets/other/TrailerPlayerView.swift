import SwiftUI
import WebKit

// ─────────── TrailerPlayerView ───────────
struct TrailerPlayerView: UIViewRepresentable {
	let url: URL
	
	func makeUIView(context: Context) -> WKWebView {
		let cfg = WKWebViewConfiguration()
		cfg.allowsInlineMediaPlayback = true
		cfg.mediaTypesRequiringUserActionForPlayback = []
		
		let web = WKWebView(frame: .zero, configuration: cfg)
		web.scrollView.isScrollEnabled = false
		web.backgroundColor = .black
		web.isOpaque = false
		return web
	}
	
	func updateUIView(_ uiView: WKWebView, context: Context) {
		uiView.load(URLRequest(url: embedURL(from: url)))
	}
	
	// MARK: – Helpers
	private func embedURL(from watchURL: URL) -> URL {
		// Already /embed/ ?
		if watchURL.path.contains("/embed/") { return watchURL }
		
		if let id = URLComponents(url: watchURL, resolvingAgainstBaseURL: false)?
			.queryItems?.first(where: { $0.name == "v" })?.value {
			// playsinline=1 keeps it inline; fs=1 shows YouTube expand btn
			let e = "https://www.youtube-nocookie.com/embed/\(id)?autoplay=1&playsinline=1&fs=1&modestbranding=1"
			return URL(string: e)!
		}
		return watchURL
	}
}

struct TrailerPlayerSheet: View {
	let url: URL
	@Environment(\.dismiss) private var dismiss
	
	var body: some View {
		ZStack {
			TrailerPlayerView(url: url)
				.ignoresSafeArea()
			
			// ─────────── Close button ───────────
			VStack {
				HStack {
					Button(action: { dismiss() }) {
						Image(systemName: "xmark")
							.font(.system(size: 16, weight: .bold))
							.foregroundColor(.primary)
							.padding(12)
							.background(.ultraThinMaterial, in: Circle())
					}
					Spacer()
				}
				Spacer()
			}
			.padding(.top, 16)
			.padding(.leading, 16)
		}
		.presentationDragIndicator(.visible)
	}
}
