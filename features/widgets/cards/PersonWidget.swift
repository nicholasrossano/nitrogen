import SwiftUI
import SDWebImageSwiftUI
import FirebaseAnalytics
import UIKit

struct PersonWidget: View {
	let metadata: PersonMetadata?
	let cardId: String?
	let height: CGFloat?
	let style: PersonPreview.Style
	
	init(
		metadata: PersonMetadata?,
		cardId: String? = nil,
		height: CGFloat? = nil,
		style: PersonPreview.Style = .bar
	) {
		self.metadata = metadata
		self.cardId   = cardId
		self.height   = height
		self.style    = style
	}
	
	var body: some View {
		Group {
			if let meta = metadata, Self.isRenderable(meta) {
				let preview = PersonPreview(
					name: meta.name ?? "",
					subtitle: meta.role ?? "",
					headshot: meta.imageURL.flatMap(URL.init),
					externalURL: meta.officialURL.flatMap(URL.init) ?? meta.wikipediaURL,
					style: style,
					height: height
				)
				
				if let cardId = cardId, !cardId.isEmpty {
					preview
						.frame(maxWidth: .infinity, alignment: .leading)
						.id(cardId)
						.overlay(InteractiveFrameReader())
						.onAppear {
							var params: [String: Any] = [
								"screen": "curator" as NSString
							]
							params["card_id"] = cardId as NSString
							let hasRole = !(metadata?.role?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
							params["has_role"] = NSNumber(value: hasRole)
							Analytics.logEvent("person_widget_impression", parameters: params)
						}
				} else {
					preview
						.frame(maxWidth: .infinity, alignment: .leading)
						.overlay(InteractiveFrameReader())
						.onAppear {
							var params: [String: Any] = [
								"screen": "curator" as NSString
							]
							let hasRole = !(metadata?.role?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
							params["has_role"] = NSNumber(value: hasRole)
							Analytics.logEvent("person_widget_impression", parameters: params)
						}
				}
			} else {
				EmptyView()
			}
		}
	}
	
	static func isRenderable(_ meta: PersonMetadata) -> Bool {
		guard
			let name = meta.name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty,
			let img  = meta.imageURL?.trimmingCharacters(in: .whitespacesAndNewlines), !img.isEmpty,
			URL(string: img) != nil
		else {
			return false
		}
		return true
	}
}

struct PersonPreview: View {
	enum Style { case bubble, bar }
	
	let name       : String
	let subtitle   : String
	let headshot   : URL?
	let externalURL: URL?
	let style      : Style
	let height     : CGFloat?
	
	@Environment(\.openURL) private var openURL
	@State private var isTapAnimating = false
	@State private var haptic: UIImpactFeedbackGenerator?
	
	init(
		name: String,
		subtitle: String,
		headshot: URL?,
		externalURL: URL?,
		style: Style,
		height: CGFloat? = nil
	) {
		self.name        = name
		self.subtitle    = subtitle
		self.headshot    = headshot
		self.externalURL = externalURL
		self.style       = style
		self.height      = height
	}
	
	private static let bubbleHeight: CGFloat = 200
	private static let barHeight: CGFloat = 96
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : Self.barHeight)
		
		GeometryReader { geo in
			let C      = constants(for: geo.size.height)
			let radius : CGFloat = 20
			let shape  : AnyShape = style == .bubble
			? AnyShape(RoundedRectangle(cornerRadius: radius))
			: AnyShape(RoundedCorner(radius: radius, corners: [.topLeft, .topRight]))
			
			let thumbHeight = C.thumbH
			let thumbWidth  = thumbHeight
			
			HStack(spacing: 20) {
				WebImage(url: headshot)
					.resizable()
					.scaledToFill()
					.frame(width: thumbWidth, height: thumbHeight)
					.clipped()
					.clipShape(RoundedRectangle(cornerRadius: 20))
					.scaleEffect(isTapAnimating ? 0.965 : 1.0)
					.contentShape(Rectangle())
				
				VStack(alignment: .leading, spacing: 2) {
					Text(name)
						.font(.headline)
						.foregroundColor(.white)
						.lineLimit(2)
					Text(subtitle)
						.font(.subheadline)
						.foregroundColor(.white.opacity(0.85))
						.lineLimit(2)
				}
				
				Spacer(minLength: 0)
			}
			.padding(.all, C.pad)
			.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
			.background {
				if let url = headshot {
					ArtworkWave(url: url, shape: shape)
				} else {
					shape.fill(Color.accentColor.opacity(0.35))
				}
			}
			.clipShape(shape)
			.overlay(shape.stroke(Color.white.opacity(0.6), lineWidth: 0.5))
			.overlay(InteractiveFrameReader().allowsHitTesting(false))
		}
		.frame(height: fixedHeight)
		.frame(maxWidth: .infinity, alignment: .leading)
		.transaction { $0.disablesAnimations = true }
	}
	
	private func constants(for h: CGFloat)
	-> (thumbW: CGFloat, thumbH: CGFloat, pad: CGFloat, icon: CGFloat) {
		switch style {
		case .bubble:
			let pad: CGFloat = 20
			let thumbH       = max(0, h - pad * 2)
			return (thumbH * 2 / 3, thumbH, pad, 22)
		case .bar:
			let pad: CGFloat = 20
			let thumbH       = max(0, h - pad * 2)
			return (thumbH * 2 / 3, thumbH, pad, max(h * 0.12, 18))
		}
	}
}
