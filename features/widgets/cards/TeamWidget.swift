import SwiftUI
import SDWebImageSwiftUI

struct TeamWidget: View {
	let metadata: TeamMetadata?
	let cardId: String?
	let height: CGFloat?
	let style: TeamPreview.Style
	
	init(
		metadata: TeamMetadata?,
		cardId: String? = nil,
		height: CGFloat? = nil,
		style: TeamPreview.Style = .bar
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
	
	private func basicContent(_ t: TeamMetadata) -> some View {
		let displayName = [t.city, t.team]
			.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
			.filter { !$0.isEmpty }
			.joined(separator: " ")
		
		let subtitle = subtitleLine(division: t.division, league: t.league)
		let externalURL = t.espnURL ?? t.wikipediaURL
		
		return TeamPreview(
			name: displayName.isEmpty ? (t.team ?? "") : displayName,
			subtitle: subtitle,
			logo: t.logoURL.flatMap(URL.init),
			externalURL: externalURL,
			ranking: t.ranking,
			record: t.recordString,
			style: style,
			height: height
		)
		.frame(maxWidth: .infinity)
	}
	
	private func subtitleLine(division: String?, league: String?) -> String {
		let div = (division ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		let lg  = (league   ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
		var parts: [String] = []
		if !div.isEmpty { parts.append(div) }
		if !lg.isEmpty  { parts.append(lg) }
		return parts.joined(separator: " • ")
	}
}

struct TeamPreview: View {
	enum Style { case bubble, bar }
	
	let name: String
	let subtitle: String
	let logo: URL?
	let externalURL: URL?
	let ranking: Int?
	let record: String?
	let style: Style
	let height: CGFloat?
	
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
				WebImage(url: logo)
					.resizable()
					.scaledToFit()
					.frame(width: C.thumbH, height: C.thumbH)
					.clipShape(RoundedRectangle(cornerRadius: 20))
				
				VStack(alignment: .leading, spacing: 2) {
					Text(name)
						.font(.headline)
						.foregroundStyle(.white)
						.lineLimit(2)
					
					if !subtitle.isEmpty {
						Text(subtitle)
							.font(.subheadline)
							.foregroundStyle(.white.opacity(0.85))
							.lineLimit(2)
					}
					
					if let metrics = metricsLine() {
						Text(metrics)
							.font(.footnote)
							.foregroundStyle(.white.opacity(0.85))
							.lineLimit(1)
							.padding(.top, 2)
					}
				}
				
				Spacer(minLength: 0)
			}
			.padding(.all, C.pad)
			.frame(maxWidth: .infinity, maxHeight: .infinity)
			.background(alignment: .center) {
				if let url = logo {
					ZStack {
						WebImage(url: url)
							.resizable()
							.aspectRatio(contentMode: .fill)
							.frame(width: geo.size.width * 3,
								   height: max(geo.size.height, fixedHeight ?? geo.size.height) * 8)
							.offset(x: -60)
							.blur(radius: 70)
							.saturation(1.8)
							.brightness(-0.08)
							.opacity(0.5)
							.blendMode(.screen)
					}
					.allowsHitTesting(false)
					.clipShape(shape)
					.drawingGroup()
				} else {
					shape.fill(Color.accentColor.opacity(0.35))
				}
			}
			.background(
				.ultraThinMaterial,
				in: shape
			)
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
	
	private func metricsLine() -> String? {
		var parts: [String] = []
		if let r = ranking, r > 0 { parts.append("#\(r)") }
		if let rec = record, !rec.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { parts.append(rec) }
		return parts.isEmpty ? nil : parts.joined(separator: " • ")
	}
}
