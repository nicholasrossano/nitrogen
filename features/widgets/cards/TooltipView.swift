import SwiftUI

struct TooltipView: View {
	let text: String
	
	var body: some View {
		VStack(alignment: .leading, spacing: 8) {
			Text(text)
				.font(.custom("Avenir", size: 16))
				.fixedSize(horizontal: false, vertical: true)
		}
		.padding(8)
		.frame(maxWidth: .infinity, alignment: .leading)
		.background(
			RoundedRectangle(cornerRadius: 10)
				.fill(.thickMaterial)
				.overlay(
					RoundedRectangle(cornerRadius: 10)
						.fill(Color.white.opacity(0.3))
				)
		)
		.shadow(radius: 1)
	}
}
