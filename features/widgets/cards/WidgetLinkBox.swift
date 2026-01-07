import SwiftUI

struct WidgetLinkBox: View {
	let links: [(String, URL)]
	let onLinkTap: (URL) -> Void
	
	var body: some View {
		VStack(alignment: .leading, spacing: 4) {
			ForEach(links.indices, id: \.self) { idx in
				if idx > 0 {
					Divider()
						.background(Color.white.opacity(0.4))
				}
				Button(links[idx].0) {
					onLinkTap(links[idx].1)
				}
				.font(.caption)
				.foregroundColor(.white)
				.padding(.vertical, 4)
				.buttonStyle(PlainButtonStyle())
			}
		}
		.padding(8)
		.background(
			RoundedRectangle(cornerRadius: 6)
				.fill(.thickMaterial)
				.overlay(
					RoundedRectangle(cornerRadius: 6)
						.fill(Color.black.opacity(0.6))
				)
		)
		.shadow(color: .black.opacity(0.4), radius: 6, x: 0, y: 4)
		.fixedSize()
	}
}
