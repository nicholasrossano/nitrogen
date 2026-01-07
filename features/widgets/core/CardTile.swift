import SwiftUI
import SDWebImageSwiftUI
import UIKit

struct CardTile: View {
	let card: Card
	let fallbackHeadline: String
	let tileWidth: CGFloat
	let tileHeight: CGFloat
	let headlineHeight: CGFloat
	let fadeHeight: CGFloat
	let headlineFontSize: CGFloat?
	
	@Environment(\.colorScheme) private var scheme
	
	init(
		card: Card,
		fallbackHeadline: String,
		tileWidth: CGFloat,
		tileHeight: CGFloat,
		headlineHeight: CGFloat,
		fadeHeight: CGFloat,
		headlineFontSize: CGFloat? = nil
	) {
		self.card = card
		self.fallbackHeadline = fallbackHeadline
		self.tileWidth = tileWidth
		self.tileHeight = tileHeight
		self.headlineHeight = headlineHeight
		self.fadeHeight = fadeHeight
		self.headlineFontSize = headlineFontSize
	}
	
	private func isValidURL(_ url: URL) -> Bool {
		if url.isFileURL { return true }
		guard let scheme = url.scheme?.lowercased() else { return false }
		return scheme == "http" || scheme == "https"
	}
	
	private var choice: WidgetManager.ShareThumbnailChoice {
		WidgetManager.previewThumbnailChoice(for: card)
	}
	
	private var isChartStyle: Bool {
		switch choice {
		case .stockChart, .politicianPoll: return true
		default: return false
		}
	}
	
	private var backgroundURL: URL? {
		switch choice {
		case .headerImage(let url):
			return isValidURL(url) ? url : nil
		case .heroImage(let url):
			return isValidURL(url) ? url : nil
		case .artwork:
			for u in card.shareArtworkURLs() where isValidURL(u) { return u }
			return nil
		case .stockChart, .politicianPoll, .none:
			return nil
		}
	}
	
	var body: some View {
		let fullHeight = tileHeight + headlineHeight
		
		ZStack {
			if isChartStyle {
				Color(.systemBackground)
			} else if let backgroundURL {
				WebImage(url: backgroundURL)
					.resizable()
					.scaledToFill()
					.frame(width: tileWidth, height: fullHeight)
					.blur(radius: 86)
					.saturation(1.25)
					.brightness(-0.22)
					.opacity(1.0)
					.clipped()
			} else {
				Color.black.opacity(scheme == .dark ? 0.72 : 0.66)
			}
			
			CardPreviewThumbnailView(
				card: card,
				fallbackHeadline: fallbackHeadline,
				renderMode: .shelfForeground,
				chrome: .none
			)
			.frame(width: tileWidth, height: tileHeight)
			.offset(y: -(headlineHeight / 2))
			
			VStack(spacing: 0) {
				Spacer(minLength: 0)
				
				Color.clear
					.frame(height: fadeHeight)
				
				HeadlineBar(
					backgroundURL: backgroundURL,
					isChartStyle: isChartStyle,
					headline: fallbackHeadline,
					headlineFontSize: headlineFontSize
				)
				.frame(height: headlineHeight)
			}
			.frame(width: tileWidth, height: fullHeight)
			.allowsHitTesting(false)
		}
		.frame(width: tileWidth, height: fullHeight)
		.clipShape(RoundedRectangle(cornerRadius: 20))
		.overlay(
			RoundedRectangle(cornerRadius: 20)
				.stroke(Color.white.opacity(scheme == .dark ? 0.14 : 0.12), lineWidth: 0.8)
		)
	}
	
	private struct HeadlineBar: View {
		let backgroundURL: URL?
		let isChartStyle: Bool
		let headline: String
		let headlineFontSize: CGFloat?
		
		@Environment(\.colorScheme) private var scheme
		
		var body: some View {
			let size = headlineFontSize ?? 14
			
			ZStack {
				if isChartStyle {
					Color(.secondarySystemBackground)
				} else {
					Color.black.opacity(scheme == .dark ? 0.5 : 0.4)
				}
				
				HStack {
					Text(headline.trimmingCharacters(in: .whitespacesAndNewlines))
						.dynamicTypeSize(.xSmall ... .large)
						.font(.custom("Avenir", size: size))
						.foregroundColor(isChartStyle ? Color.primary : Color.white)
						.multilineTextAlignment(.leading)
						.lineLimit(3)
						.minimumScaleFactor(0.92)
						.allowsTightening(true)
					
					Spacer(minLength: 0)
				}
				.padding(.horizontal, 18)
				.padding(.vertical, 12)
			}
		}
	}
}
