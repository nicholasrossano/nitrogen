import SwiftUI

struct BannerView: View {
	@ObservedObject var bannerManager: BannerManager
	@State private var offsetY: CGFloat = -200
	
	var body: some View {
		if let banner = bannerManager.currentBanner {
			VStack(spacing: 4) {
				HStack(alignment: .top) {
					VStack(alignment: .leading, spacing: 2) {
						Text(banner.headline)
							.font(.headline)
							.foregroundColor(.primary)
						Text(banner.body)
							.font(.subheadline)
							.foregroundColor(.primary)
					}
					Spacer()
				}
				.padding(12)
			}
			.background(
				RoundedRectangle(cornerRadius: 20, style: .continuous)
					.fill(.thinMaterial)
			)
			.shadow(color: Color.black.opacity(0.1), radius: 4, x: 0, y: 2)
			.padding(.horizontal)
			.padding(.top, 12)
			.offset(y: offsetY)
			.gesture(
				DragGesture().onEnded { value in
					if value.translation.height < -20 {
						dismissBanner()
					}
				}
			)
			.onAppear {
				DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
					withAnimation(.easeOut(duration: 0.4)) {
						offsetY = 0
					}
				}
				DispatchQueue.main.asyncAfter(deadline: .now() + 20) {
					if bannerManager.currentBanner?.id == banner.id {
						dismissBanner()
					}
				}
			}
			.transition(.move(edge: .top))
			.animation(.easeInOut, value: banner)
		}
	}
	
	private func dismissBanner() {
		withAnimation(.easeIn(duration: 0.3)) {
			offsetY = -200
		}
		DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
			bannerManager.dismissBanner()
		}
	}
}
