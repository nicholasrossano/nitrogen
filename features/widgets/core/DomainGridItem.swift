import SwiftUI
import SDWebImageSwiftUI
import SDWebImage
import UIKit

struct DomainGridItem: View {
	let domain: Domain
	let onSelected: ((Domain) -> Void)?
	var isClickable: Bool = true
	@State private var didLoadImage: Bool = false
	
	var body: some View {
		let w       = UIScreen.main.bounds.width
		let imgH    = w * 0.5
		let pad     = w * 0.03
		let titleSize: CGFloat = 18
		
		ZStack(alignment: .bottom) {
			if !domain.name.isEmpty {
				Button {
					if isClickable { onSelected?(domain) }
				} label: {
					ZStack {
						if let urlString = domain.imageUrl, !urlString.isEmpty {
							if urlString.lowercased().hasPrefix("http"),
							   let url = URL(string: urlString) {
								SDRemoteImage(
									url: url,
									height: imgH,
									cornerRadius: 24
								) {
									didLoadImage = true
								}
							} else if let uiImage = UIImage(named: urlString) {
								Image(uiImage: uiImage)
									.resizable()
									.aspectRatio(contentMode: .fill)
									.frame(maxWidth: .infinity, alignment: .bottom)
									.frame(height: imgH, alignment: .bottom)
									.clipped()
									.cornerRadius(24)
									.transition(.opacity)
							} else {
								Rectangle()
									.fill(Color.gray.opacity(0.3))
									.frame(height: imgH)
									.cornerRadius(24)
									.shimmer()
							}
						} else {
							Rectangle()
								.fill(Color.gray.opacity(0.3))
								.frame(height: imgH)
								.cornerRadius(24)
								.shimmer()
						}
						
						LinearGradient(
							gradient: Gradient(colors: [.black.opacity(0.15), .black.opacity(0.5)]),
							startPoint: .top,
							endPoint: .bottom
						)
						.cornerRadius(24)
						
						VStack {
							Spacer()
							HStack {
								Text(domain.name)
									.font(.custom("Didot", size: titleSize))
									.fontWeight(.medium)
									.foregroundColor(.white)
									.padding(.horizontal, pad)
									.multilineTextAlignment(.leading)
									.lineLimit(2)
									.truncationMode(.tail)
									.minimumScaleFactor(0.9)
									.fixedSize(horizontal: false, vertical: true)
								Spacer()
							}
							.padding(.bottom, pad)
						}
					}
				}
				.disabled(!isClickable)
				.buttonStyle(PressDownHapticButtonStyle())
			}
		}
		.shadow(color: .black.opacity(0.2), radius: 6, x: 0, y: 4)
		.frame(height: imgH)
		.frame(maxWidth: .infinity)
		.onChange(of: domain.imageUrl) { _ in
			didLoadImage = false
		}
	}
}

private struct SDRemoteImage: View {
	let url: URL
	let height: CGFloat
	let cornerRadius: CGFloat
	let onLoaded: () -> Void
	
	@State private var uiImage: UIImage?
	
	var body: some View {
		Group {
			if let uiImage {
				Image(uiImage: uiImage)
					.resizable()
					.aspectRatio(contentMode: .fill)
					.frame(maxWidth: .infinity, alignment: .bottom)
					.frame(height: height, alignment: .bottom)
					.clipped()
					.cornerRadius(cornerRadius)
					.transition(.opacity)
			} else {
				Color.clear
					.frame(height: height)
					.cornerRadius(cornerRadius)
			}
		}
		.task(id: url) {
			if let key = SDWebImageManager.shared.cacheKey(for: url),
			   let cached = SDImageCache.shared.imageFromCache(forKey: key) {
				uiImage = cached
				onLoaded()
				return
			}
			SDWebImageManager.shared.loadImage(
				with: url,
				options: [.continueInBackground, .highPriority, .scaleDownLargeImages],
				progress: nil
			) { image, _, _, _, finished, _ in
				if let image, finished {
					uiImage = image
					onLoaded()
				}
			}
		}
	}
}

// ─────────── Press style with scale + light haptic ───────────
private struct PressDownHapticButtonStyle: ButtonStyle {
	func makeBody(configuration: Configuration) -> some View {
		configuration.label
			.scaleEffect(configuration.isPressed ? 0.965 : 1.0)
			.animation(.spring(response: 0.18, dampingFraction: 0.7), value: configuration.isPressed)
			.onChange(of: configuration.isPressed) { pressed in
				guard pressed else { return }
				let g = UIImpactFeedbackGenerator(style: .light)
				g.prepare()
				g.impactOccurred(intensity: 0.7)
			}
	}
}
