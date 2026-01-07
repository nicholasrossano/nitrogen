import SwiftUI

// ─────────── Link Tile ───────────
struct LegalLinkTile: View {
	let title: String
	let systemImage: String
	let action: () -> Void
	
	var body: some View {
		let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
		
		Button(action: action) {
			VStack(spacing: 8) {
				Image(systemName: systemImage)
					.font(.system(size: 28, weight: .semibold))
					.foregroundColor(Color.accentSecondary)
				Text(title)
					.font(.custom("Avenir-Medium", size: 16))
					.foregroundColor(.primary)
			}
			.frame(maxWidth: .infinity)
			.padding(.vertical, 18)
			.background(.ultraThinMaterial, in: shape)
			.overlay(shape.stroke(Color.white.opacity(0.7), lineWidth: 0.5))
		}
	}
}

// ─────────── Legal View ───────────
struct LegalView: View {
	@State private var showPrivacy = false
	@State private var showTerms   = false
	
	private let privacyURL = URL(string: "https://www.ponder-app.ai/legal/privacy-policy")!
	private let termsURL   = URL(string: "https://www.ponder-app.ai/legal/terms-and-conditions")!
	
	private let logos = [
		"AppleMusic-Logo",
		"Spotify-Logo",
		"IGDB-Logo",
		"IMDb-Logo",
		"TMDB-Logo"
	]
	
	var body: some View {
		NavigationStack {
			ScrollView {
				VStack(alignment: .leading, spacing: 24) {
					
					// ─────────── Top Link Tiles ───────────
					HStack(spacing: 30) {
						LegalLinkTile(
							title: "Privacy Policy",
							systemImage: "lock.document.fill"
						) { showPrivacy = true }
						
						LegalLinkTile(
							title: "Terms & Conditions",
							systemImage: "text.rectangle.page.fill"
						) { showTerms = true }
					}
					
					// ─────────── Attributions ───────────
					VStack(alignment: .center, spacing: 40) {
						Text("Attributions")
							.font(.custom("Avenir-Medium", size: 18))
							.frame(maxWidth: .infinity, alignment: .center)
						
						LazyVGrid(
							columns: [GridItem(.adaptive(minimum: 120), spacing: 30, alignment: .center)],
							spacing: 50
						) {
							ForEach(logos, id: \.self) { name in
								Image(name)
									.renderingMode(.original)
									.resizable()
									.scaledToFit()
									.frame(height: 40)
									.accessibilityHidden(true)
							}
						}
						
						Text("Some purchase links within cards may be affiliate links. If you make a purchase through these, we may earn a commission at no additional cost to you.")
							.font(.custom("Avenir", size: 14))
							.foregroundColor(.secondary)
							.multilineTextAlignment(.center)
							.frame(maxWidth: .infinity)
					}
				}
				.padding(20)
				.font(.custom("Avenir", size: 17))
				.foregroundColor(.primary)
			}
			.customNavigation(title: "Legal")
			.navigationBarBackButtonHidden(true)
			.swipeBack()
			.sheet(isPresented: $showPrivacy) { SafariView(url: privacyURL) }
			.sheet(isPresented: $showTerms)   { SafariView(url: termsURL) }
		}
	}
}

// ─────────── Preview ───────────
struct LegalView_Previews: PreviewProvider {
	static var previews: some View {
		LegalView().preferredColorScheme(.light)
		LegalView().preferredColorScheme(.dark)
	}
}
