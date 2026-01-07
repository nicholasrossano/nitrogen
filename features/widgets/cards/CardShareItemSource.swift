import UIKit
import LinkPresentation
import UniformTypeIdentifiers

class CardShareItemSource: NSObject, UIActivityItemSource {
	// ─────────── Inputs ───────────
	let headlineImage: UIImage
	let deepLinkURL: URL
	let topicName: String
	
	init(headlineImage: UIImage, deepLinkURL: URL, topicName: String) {
		self.headlineImage = headlineImage
		self.deepLinkURL = deepLinkURL
		self.topicName = topicName
		super.init()
	}
	
	// ─────────── UIActivityItemSource ───────────
	func activityViewControllerPlaceholderItem(_ activityViewController: UIActivityViewController) -> Any {
		return deepLinkURL
	}
	
	func activityViewController(_ activityViewController: UIActivityViewController,
								itemForActivityType activityType: UIActivity.ActivityType?) -> Any? {
		let raw = activityType?.rawValue.lowercased() ?? ""
		if raw.contains("whatsapp") || raw.contains("instagram") {
			return deepLinkURL.absoluteString
		}
		return deepLinkURL
	}
	
	func activityViewController(_ activityViewController: UIActivityViewController,
								dataTypeIdentifierForActivityType activityType: UIActivity.ActivityType?) -> String {
		let raw = activityType?.rawValue.lowercased() ?? ""
		if raw.contains("whatsapp") || raw.contains("instagram") {
			if #available(iOS 14.0, *) { return UTType.plainText.identifier } else { return "public.plain-text" }
		}
		if #available(iOS 14.0, *) { return UTType.url.identifier } else { return "public.url" }
	}
	
	func activityViewController(_ activityViewController: UIActivityViewController,
								activityViewControllerLinkMetadata activityViewController2: UIActivityViewController) -> LPLinkMetadata? {
		return activityViewControllerLinkMetadata(activityViewController)
	}
	
	func activityViewController(_ activityViewController: UIActivityViewController,
								linkMetadataForActivityType activityType: UIActivity.ActivityType?) -> LPLinkMetadata? {
		return activityViewControllerLinkMetadata(activityViewController)
	}
	
	func activityViewControllerLinkMetadata(_ activityViewController: UIActivityViewController) -> LPLinkMetadata? {
		let metadata = LPLinkMetadata()
		metadata.originalURL = deepLinkURL
		metadata.url = deepLinkURL
		metadata.title = topicName
		metadata.imageProvider = NSItemProvider(object: headlineImage)
		metadata.iconProvider  = NSItemProvider(object: headlineImage)
		return metadata
	}
	
	func activityViewController(_ activityViewController: UIActivityViewController,
								subjectForActivityType activityType: UIActivity.ActivityType?) -> String {
		return topicName
	}
}
