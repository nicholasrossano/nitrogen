import SwiftUI
import StoreKit
import UIKit
import FirebaseAnalytics

struct PremiumView: View {
	@Environment(\.dismiss) private var dismiss
	@StateObject private var viewModel = PremiumViewModel()
	
	var body: some View {
		GeometryReader { geo in
			ZStack {
				Color.clear
					.background(.thinMaterial)
					.ignoresSafeArea()
				
				VStack(spacing: 16) {
					Image(systemName: "crown.fill")
						.font(.system(size: 50))
						.foregroundColor(Color("Beige"))
						.padding(.vertical, 60)
					
					Text("Foreword+ gives power users even more potential.\n\n\n\nUnlock unlimited exchanges with the Curator and get first access to new features.")
						.font(.custom("Avenir", size: 18))
						.multilineTextAlignment(.center)
						.padding(.horizontal, 32)
					
					Spacer()
					Spacer()
					
					if let price = viewModel.displayPrice {
						Text(price)
							.font(.custom("Avenir", size: 16))
							.foregroundColor(.secondary)
					}
					
					Button {
						if viewModel.isSubscribed {
							Analytics.logEvent("premium_primary_tap", parameters: [
								"screen": "premium" as NSString,
								"action": "manage" as NSString
							])
							openAppStoreSubscriptions()
						} else {
							Analytics.logEvent("premium_primary_tap", parameters: [
								"screen": "premium" as NSString,
								"action": "subscribe" as NSString
							])
							Task { await viewModel.subscribe() }
						}
					} label: {
						Text(viewModel.buttonTitle)
							.font(.custom("Avenir", size: 16))
							.foregroundColor(Color(.systemBackground))
							.padding(.horizontal, 24)
							.padding(.vertical, 10)
							.frame(maxWidth: .infinity)
							.background(Color("AccentSecondary"))
							.clipShape(Capsule())
					}
					.disabled(!viewModel.isSubscribed && !viewModel.canPurchase)
					.padding(.horizontal, 32)
					.padding(.top, 8)
					
					CloseButton(systemName: "xmark", size: 40) {
						Analytics.logEvent("premium_close_tap", parameters: [
							"screen": "premium" as NSString
						])
						dismiss()
					}
					.accessibilityLabel("Dismiss")
					.padding(.top, 4)
				}
				.frame(width: geo.size.width)
			}
		}
		.task { await viewModel.loadProducts() }
		.onAppear {
			Analytics.logEvent("premium_view_appear", parameters: [
				"screen": "premium" as NSString
			])
		}
		.onChange(of: viewModel.isSubscribed) { subscribed in
			if subscribed { dismiss() }
		}
	}
	
	private func benefit(_ text: String) -> some View {
		Label {
			Text(text).font(.custom("Avenir", size: 16))
		} icon: {
			Image(systemName: "arrowtriangle.right.fill")
				.font(.system(size: 10, weight: .semibold))
		}
	}
	
	private func openAppStoreSubscriptions() {
		if let scene = UIApplication.shared.connectedScenes
			.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
			Task {
				try? await AppStore.showManageSubscriptions(in: scene)
			}
		} else {
			guard let url = URL(string: "https://apps.apple.com/account/subscriptions") else { return }
			UIApplication.shared.open(url)
		}
	}
}

struct PremiumView_Previews: PreviewProvider {
	static var previews: some View { PremiumView() }
}
