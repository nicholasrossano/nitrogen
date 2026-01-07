import SwiftUI
import SDWebImageSwiftUI

struct AthleteWidget: View {
	let metadata: AthleteMetadata?
	let cardId: String?
	let height: CGFloat?
	let style: AthletePreview.Style
	
	init(
		metadata: AthleteMetadata?,
		cardId: String? = nil,
		height: CGFloat? = nil,
		style: AthletePreview.Style = .bar
	) {
		self.metadata = metadata
		self.cardId   = cardId
		self.height   = height
		self.style    = style
	}
	
	var body: some View {
		Group {
			if let meta = metadata {
				basicContent(meta)
					.id(cardId)
					.overlay(InteractiveFrameReader())
			} else {
				EmptyView()
			}
		}
	}
	
	private func cleanToken(_ input: String?) -> String? {
		guard var text = input?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
			return nil
		}
		text = text.replacingOccurrences(of: #"^\s*[._\-–—•:·]+\s*"#, with: "", options: .regularExpression)
		text = text.replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
		text = text.trimmingCharacters(in: .whitespacesAndNewlines)
		return text.isEmpty ? nil : text
	}
	
	private func basicContent(_ ath: AthleteMetadata) -> some View {
		let cleanedPosition = cleanToken(ath.position)
		let cleanedTeam     = cleanToken(ath.team)
		let cleanedLeague   = cleanToken(ath.league)
		
		let rightParts = [cleanedTeam, cleanedLeague].compactMap { $0 }
		let right = rightParts.isEmpty ? nil : rightParts.joined(separator: " • ")
		
		let subtitle = [cleanedPosition, right]
			.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
			.joined(separator: " • ")
		
		let externalURL = ath.espnURL ?? ath.wikipediaURL
		
		return AthletePreview(
			name: ath.name ?? "",
			subtitle: subtitle,
			headshot: ath.imageURL.flatMap(URL.init),
			externalURL: externalURL,
			ranking: ath.ranking,
			style: style,
			height: height
		)
		.frame(maxWidth: .infinity)
	}
}

struct AthletePreview: View {
	enum Style { case bubble, bar }
	
	let name: String
	let subtitle: String
	let headshot: URL?
	let externalURL: URL?
	let ranking: Int?
	let style: Style
	let height: CGFloat?
	
	@Environment(\.colorScheme) private var colorScheme
	@Environment(\.openURL) private var openURL
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
				WebImage(url: headshot)
					.resizable()
					.scaledToFill()
					.frame(width: C.thumbW, height: C.thumbH)
					.background(Color.customSystemGray(for: colorScheme))
					.clipShape(RoundedRectangle(cornerRadius: 20))
				
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
			.overlay(alignment: .topLeading) {
				if let r = ranking {
					BadgeView(text: "#\(r)")
						.padding(.leading, C.pad)
						.padding(.top, C.pad)
				}
			}
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
	
	private struct BadgeView: View {
		let text: String
		var body: some View {
			Text(text)
				.font(.caption.bold())
				.padding(.horizontal, 8)
				.padding(.vertical, 4)
				.background(.ultraThinMaterial, in: Capsule())
				.foregroundStyle(.white)
				.overlay(Capsule().stroke(Color.white.opacity(0.6), lineWidth: 0.5))
		}
	}
}
