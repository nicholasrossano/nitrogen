import UIKit
import UniformTypeIdentifiers

class CardSharePlatformImageSource: NSObject, UIActivityItemSource {
	// ─────────── Inputs ───────────
	private let image: UIImage
	private let deepLinkURL: URL
	
	init(image: UIImage, deepLinkURL: URL) {
		self.image = image
		self.deepLinkURL = deepLinkURL
		super.init()
	}
	
	func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
		return image
	}
	
	func activityViewController(_ activityViewController: UIActivityViewController,
								itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
		guard let raw = activityType?.rawValue.lowercased() else { return nil }
		
		if raw.contains("whatsapp") {
			return image
		}
		
		if raw.contains("instagram") {
			UIPasteboard.general.string = deepLinkURL.absoluteString
			return image
		}
		
		return nil
	}
	
	func activityViewController(_ activityViewController: UIActivityViewController,
								dataTypeIdentifierForActivityType activityType: UIActivity.ActivityType?) -> String {
		if #available(iOS 14.0, *) { return UTType.image.identifier } else { return "public.image" }
	}
}
