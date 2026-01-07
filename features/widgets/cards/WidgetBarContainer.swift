import SwiftUI
import SDWebImageSwiftUI

struct WidgetBarContainer: View {
	let card: Card
	let geometry: GeometryProxy
	let barHeight: CGFloat
	
	init(
		card: Card,
		geometry: GeometryProxy,
		barHeight: CGFloat = UIScreen.main.bounds.width * 0.18
	) {
		self.card      = card
		self.geometry  = geometry
		self.barHeight = barHeight
	}
	
	var body: some View {
		let urls = artworkURLs()
		
		WidgetManager.build(
			card:         card,
			geometry:     geometry,
			widgetHeight: barHeight
		)
		.frame(maxWidth: .infinity)
		.frame(height: barHeight)
		.transaction { $0.disablesAnimations = true }
		.background(alignment: .center) {
			if !urls.isEmpty {
				ZStack {
					ForEach(Array(urls.enumerated()), id: \.offset) { idx, url in
						WebImage(url: url)
							.resizable()
							.aspectRatio(contentMode: .fill)
							.frame(width: geometry.size.width * 3,
								   height: barHeight * 8)
							.offset(x: CGFloat(idx) * 60 - 60)
							.blur(radius: 70)
							.saturation(1.8)
							.brightness(-0.08)
							.opacity(0.5)
							.blendMode(.screen)
					}
				}
				.allowsHitTesting(false)
				.clipShape(RoundedCorner(radius: 24, corners: [.topLeft, .topRight]))
				.drawingGroup()
			}
		}
		.background(
			.ultraThinMaterial,
			in: RoundedCorner(radius: 24, corners: [.topLeft, .topRight])
		)
		.overlay(
			RoundedCorner(radius: 24, corners: [.topLeft, .topRight])
				.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
		)
		.clipShape(RoundedCorner(radius: 24, corners: [.topLeft, .topRight]))
	}
}

private extension WidgetBarContainer {
	func artworkURLs() -> [URL] {
		var urls: [URL] = []
		
		if let gen = card.enrichedMetadata?.generatedArtURL,
		   let u = URL(string: gen) { urls.append(u) }
		else if let gen2 = card.enrichedMetadata?.genArtwork?.url,
				let u = URL(string: gen2) { urls.append(u) }
		
		if let u = card.enrichedMetadata?.musicMetadata?.artworkURL { urls.append(u) }
		
		if let poster = card.enrichedMetadata?.filmTvMetadata?.poster,
		   !poster.isEmpty, poster != "N/A",
		   let u = URL(string: poster) { urls.append(u) }
		
		if let head = card.enrichedMetadata?.filmTvPerson?.imageURL,
		   !head.isEmpty,
		   let u = URL(string: head) {
			urls.append(u)
		}
		
		if let u = card.enrichedMetadata?.bookMetadata?.coverURLCandidates().first {
			urls.append(u)
		}
		
		if let meta = card.enrichedMetadata?.politicianMetadata,
		   let img = meta.imageURL,
		   let u = URL(string: img) {
			let hasPoll = !(meta.pollSeries?.isEmpty ?? true)
			if !hasPoll { urls.append(u) }
		}
		
		if let img = card.enrichedMetadata?.athleteMetadata?.imageURL,
		   let u = URL(string: img) { urls.append(u) }
		
		if let logo = card.enrichedMetadata?.teamMetadata?.logoURL,
		   let u = URL(string: logo) { urls.append(u) }
		
		if let img = card.enrichedMetadata?.personMetadata?.imageURL,
		   !img.isEmpty,
		   let u = URL(string: img) {
			urls.append(u)
		}
		
		if let sm = card.enrichedMetadata?.stockMetadata {
			let hasChart = !(sm.dataPoints?.isEmpty ?? true) && sm.ticker != nil
			if !hasChart,
			   let logo = sm.companyLogoURL,
			   !logo.isEmpty,
			   let u = URL(string: logo) {
				urls.append(u)
			}
		}
		
		return urls
	}
}
