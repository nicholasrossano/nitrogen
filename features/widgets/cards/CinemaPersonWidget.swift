import SwiftUI
import SDWebImageSwiftUI
import FirebaseAnalytics
import UIKit

struct CinemaPersonWidget: View {
	let metadata: FilmTvPersonMetadata?
	let cardId: String?
	let topicId: String?
	let height: CGFloat?
	let style: CinemaPersonPreview.Style
	
	init(
		metadata: FilmTvPersonMetadata?,
		cardId: String? = nil,
		topicId: String? = nil,
		height: CGFloat? = nil,
		style: CinemaPersonPreview.Style = .bar
	) {
		self.metadata = metadata
		self.cardId = cardId
		self.topicId = topicId
		self.height = height
		self.style = style
	}
	
	var body: some View {
		Group {
			if let meta = metadata {
				CinemaPersonPreview(
					name: meta.name ?? "",
					subtitle: subtitle(from: meta),
					headshot: meta.imageURL.flatMap(URL.init),
					externalURL: preferredExternalURL(from: meta),
					style: style,
					height: height,
					onOpen: { dest in
						logOpenLink(trigger: "tap", destination: dest)
					}
				)
				.id(cardId)
				.overlay(InteractiveFrameReader())
			} else {
				EmptyView()
			}
		}
	}
	
	private func subtitle(from m: FilmTvPersonMetadata) -> String {
		let left  = (m.role ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let right = (m.knownFor ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		switch (left.isEmpty, right.isEmpty) {
		case (false, false): return "\(left) • \(right)"
		case (false, true):  return left
		case (true, false):  return right
		default:             return ""
		}
	}
	
	private func preferredExternalURL(from m: FilmTvPersonMetadata) -> URL? {
		if let url = m.imdbURL { return url }
		if let url = m.tmdbURL { return url }
		if let id  = m.imdbID, let url = URL(string: "https://www.imdb.com/name/\(id)/") { return url }
		return nil
	}
	
	private func logOpenLink(trigger: String, destination: String) {
		var params: [String: NSObject] = [
			"widget": NSString(string: "cinema_person"),
			"trigger": NSString(string: trigger),
			"destination": NSString(string: destination)
		]
		if let c = cardId { params["card_id"] = NSString(string: c) }
		if let t = topicId { params["topic_id"] = NSString(string: t) }
		params["screen"] = NSString(string: "curator")
		Analytics.logEvent("widget_open_link", parameters: params)
	}
}

struct CinemaPersonPreview: View {
	enum Style { case bubble, bar }
	
	let name: String
	let subtitle: String
	let headshot: URL?
	let externalURL: URL?
	let style: Style
	let height: CGFloat?
	let onOpen: (String) -> Void
	
	@Environment(\.colorScheme) private var colorScheme
	@State private var isTapAnimating = false
	@State private var haptic: UIImpactFeedbackGenerator?
	
	private static let bubbleHeight: CGFloat = 200
	
	var body: some View {
		let fixedHeight = height ?? (style == .bubble ? Self.bubbleHeight : nil)
		
		GeometryReader { geo in
			let C = constants(for: geo.size.height)
			let radius: CGFloat = 20
			let shape: AnyShape = style == .bubble
			? AnyShape(RoundedRectangle(cornerRadius: radius))
			: AnyShape(RoundedCorner(radius: radius, corners: [.topLeft, .topRight]))
			
			HStack(spacing: 20) {
				ZStack {
					WebImage(url: headshot)
						.resizable()
						.scaledToFill()
						.frame(width: C.thumbW, height: C.thumbH)
						.background(Color.customSystemGray(for: colorScheme))
						.clipShape(RoundedRectangle(cornerRadius: 20))
				}
				
				VStack(alignment: .leading, spacing: 2) {
					Text(name)
						.font(.headline)
						.foregroundStyle(.white)
						.lineLimit(2)
					Text(subtitle)
						.font(.subheadline)
						.foregroundStyle(.white.opacity(0.85))
						.lineLimit(2)
				}
				
				Spacer(minLength: 0)
			}
			.padding(.all, C.pad)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
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
		.transaction { $0.disablesAnimations = true }
	}
	
	private func constants(for h: CGFloat)
	-> (thumbW: CGFloat, thumbH: CGFloat, pad: CGFloat, icon: CGFloat) {
		switch style {
		case .bubble:
			let pad: CGFloat = 20
			let thumbH = max(0, h - pad * 2)
			return (thumbH * 2 / 3, thumbH, pad, 22)
		case .bar:
			let pad: CGFloat = 20
			let thumbH = max(0, h - pad * 2)
			return (thumbH * 2 / 3, thumbH, pad, max(h * 0.12, 18))
		}
	}
}
