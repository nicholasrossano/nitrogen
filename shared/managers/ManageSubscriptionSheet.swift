import SwiftUI
import StoreKit
import UIKit
import FirebaseAnalytics

struct ManageSubscriptionSheet: View {
	@Environment(\.dismiss) private var dismiss
	
	private let productIDs = AppProductID.allCases.map { $0.rawValue }
	
	var body: some View {
		if #available(iOS 17.0, *) {
			VStack(spacing: 8) {
				SubscriptionStoreView(productIDs: productIDs)
					.frame(maxHeight: .infinity)
					.onDisappear { Task { await SubscriptionStatus.shared.refresh() } }
				
				Button(role: .destructive) {
					Analytics.logEvent("premium_manage_system_tap", parameters: [
						"screen": "premium_manage" as NSString
					])
					Task { await openSystemManageSheet() }
				} label: {
					Text("Manage Subscription")
						.font(.custom("Avenir", size: 16))
						.foregroundColor(Color.accentSecondary)
						.frame(maxWidth: .infinity)
						.padding(.vertical, 12)
				}
			}
			.presentationDragIndicator(.visible)
		} else {
			VStack(spacing: 24) {
				Text("Manage or cancel your subscription in the App Store.")
					.multilineTextAlignment(.center)
					.padding(.horizontal)
				
				Button("Manage Subscription", role: .destructive) {
					Analytics.logEvent("premium_manage_system_tap", parameters: [
						"screen": "premium_manage" as NSString
					])
					Task { await openSystemManageSheet() }
				}
				
				Button("Close") { dismiss() }
			}
			.padding()
		}
	}
	
	private func openSystemManageSheet() async {
		if let scene = UIApplication.shared.connectedScenes
			.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
			try? await AppStore.showManageSubscriptions(in: scene)
		}
		await SubscriptionStatus.shared.refresh()
	}
}
