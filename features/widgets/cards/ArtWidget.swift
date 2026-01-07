import SwiftUI
import SDWebImageSwiftUI
import FirebaseAnalytics

struct ArtWidget: View {
	let enrichedMetadata: EnrichedMetadata?
	let cardId: String?
	let height: CGFloat?
	
	init(enrichedMetadata: EnrichedMetadata?, cardId: String? = nil, height: CGFloat? = nil) {
		self.enrichedMetadata = enrichedMetadata
		self.cardId = cardId
		self.height = height
	}
	
	var body: some View {
		GeometryReader { geo in
			if let url = artworkURL() {
				WebImage(url: url)
					.onSuccess { _, _, _ in
						var params: [String: Any] = ["screen": "curator" as NSString]
						if let cardId { params["card_id"] = cardId as NSString }
						Analytics.logEvent("art_widget_load_success", parameters: params)
					}
					.onFailure { error in
						var params: [String: Any] = [
							"screen": "curator" as NSString,
							"reason": error.localizedDescription as NSString
						]
						if let cardId { params["card_id"] = cardId as NSString }
						Analytics.logEvent("art_widget_load_failure", parameters: params)
					}
					.resizable()
					.aspectRatio(contentMode: .fill)
					.frame(width: geo.size.width, height: geo.size.height)
					.clipped()
					.onAppear {
						var params: [String: Any] = ["screen": "curator" as NSString]
						if let cardId { params["card_id"] = cardId as NSString }
						Analytics.logEvent("art_widget_impression", parameters: params)
					}
					.allowsHitTesting(false)
			} else {
				Color.clear
			}
		}
		.frame(height: height)
		.transaction { $0.disablesAnimations = true }
	}
	
	private func artworkURL() -> URL? {
		if let s = enrichedMetadata?.generatedArtURL, let u = URL(string: s) { return u }
		if let s = enrichedMetadata?.genArtwork?.url, let u = URL(string: s) { return u }
		return nil
	}
}
