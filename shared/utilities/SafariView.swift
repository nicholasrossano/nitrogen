import SwiftUI
import SafariServices

struct SafariView: UIViewControllerRepresentable {
	let url: URL
	var entersReaderIfAvailable: Bool = true
	
	func makeUIViewController(context: Context) -> SFSafariViewController {
		let cfg = SFSafariViewController.Configuration()
		cfg.entersReaderIfAvailable = entersReaderIfAvailable
		let vc = SFSafariViewController(url: url, configuration: cfg)
		vc.dismissButtonStyle = .close
		vc.preferredControlTintColor = UIColor(named: "AccentSecondary")
		return vc
	}
	func updateUIViewController(_ vc: SFSafariViewController, context: Context) {}
}

extension URL: Identifiable { public var id: String { absoluteString } }
