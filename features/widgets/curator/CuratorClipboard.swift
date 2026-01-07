import UIKit
import FirebaseAnalytics

// ─────────── CuratorClipboard ───────────
enum CuratorClipboard {
	static func copyMarkdownAsPlainText(_ markdown: String) {
		let plain = MarkdownCopyFormatter.plainText(from: markdown)
		UIPasteboard.general.string = plain
		
		Analytics.logEvent("curator_copy", parameters: [
			"length": NSNumber(value: plain.count),
			"screen": "curator" as NSString
		])
	}
}
