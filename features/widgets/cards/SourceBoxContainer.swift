import SwiftUI

struct SourceBoxContainer: View {
	let sources: [Source]
	let cardId : String
	
	// ─────────── Geometry constants ───────────
	private var screenWidth : CGFloat { UIScreen.main.bounds.width }
	private var circleSize  : CGFloat { screenWidth * 0.065 }   // must match SourceBox
	private let spacing     : CGFloat = 10
	private let sidePad     : CGFloat = 12
	private let barHeight   : CGFloat = UIScreen.main.bounds.width * 0.10
	private let maxWidthRatio: CGFloat = 0.70                    // 70 % of screen
	
	var body: some View {
		// ─────────── Dynamic width calculation ───────────
		let rawContentW = CGFloat(sources.count) * (circleSize + spacing) - spacing
		let contentW    = rawContentW + sidePad * 2            // add interior padding
		let maxW        = screenWidth * maxWidthRatio
		let barWidth    = min(contentW, maxW)
		
		// ─────────── Chip row inside a horizontal scroll view ───────────
		ScrollView(.horizontal, showsIndicators: false) {
			HStack(spacing: spacing) {
				ForEach(Array(sources.enumerated()), id: \.offset) { idx, src in
					SourceBox(source: src,
							  index : idx,
							  cardId: cardId)
					.environmentObject(AppServicesLocator.shared)
				}
			}
			.padding(.horizontal, sidePad)
			.frame(height: barHeight)
		}
		.frame(width: barWidth, height: barHeight, alignment: .leading)
		.background(
			.ultraThinMaterial,
			in: RoundedCorner(radius: 10, corners: [.bottomLeft, .bottomRight])
		)
		.overlay(
			RoundedCorner(radius: 10, corners: [.bottomLeft, .bottomRight])
				.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
		)
		.clipShape(
			RoundedCorner(radius: 10, corners: [.bottomLeft, .bottomRight])
		)
		.shadow(color: .black.opacity(0.2), radius: 6, x: 0, y: 4)
	}
}
