import SwiftUI
import SDWebImageSwiftUI

struct ArtworkWave: View {
	// ─────────── Inputs ───────────
	let url  : URL?
	let shape: AnyShape
	
	// ─────────── Body ───────────
	var body: some View {
		GeometryReader { geo in
			ZStack {
				WebImage(url: url)
					.resizable()
					.aspectRatio(contentMode: .fill)
					.frame(
						width : geo.size.width * 3,
						height: geo.size.height * 8
					)
					.offset(x: -60)
					.blur(radius: 70)
					.saturation(1.5)
					.brightness(-0.08)
					.opacity(0.5)
					.blendMode(.screen)
				
				Color.black.opacity(0.25)
			}
			.clipShape(shape)
		}
	}
}
