// ProfileButton.swift

import SwiftUI
import FirebaseAnalytics

struct ProfileButton: View {
	var side: CGFloat = 32
	var action: () -> Void
	
	@EnvironmentObject private var homeViewModel: HomeViewModel
	@State private var isOpen: Bool = false
	
	var body: some View {
		let icon = side * 0.50
		
		Button(action: {
			let generator = UIImpactFeedbackGenerator(style: .heavy)
			generator.impactOccurred()
			
			let domainId   = (homeViewModel.overrideDomains?.first?.id) ?? (homeViewModel.selectedDomain?.id) ?? "home"
			let domainName = (homeViewModel.overrideDomains?.first?.name) ?? (homeViewModel.selectedDomain?.name) ?? "Unknown"
			
			Analytics.logEvent("home_profile_open", parameters: [
				"domain_id": domainId as NSString,
				"domain_name": domainName as NSString,
				"trigger": "tap" as NSString,
				"screen": "home" as NSString
			])
			
			action()
		}) {
			ZStack {
				Image(systemName: "gear")
					.font(.system(size: icon, weight: .semibold))
					.opacity(isOpen ? 0.0 : 1.0)
					.scaleEffect(isOpen ? 0.8 : 1.0)
				
				Image(systemName: "xmark")
					.font(.system(size: icon, weight: .semibold))
					.opacity(isOpen ? 1.0 : 0.0)
					.scaleEffect(isOpen ? 1.0 : 0.8)
			}
			.foregroundColor(.white)
			.rotationEffect(.degrees(isOpen ? 180 : 0))
			.frame(width: side, height: side)
			.compositingGroup()
			.animation(.easeInOut(duration: 0.30), value: isOpen)
		}
		.contentShape(Circle())
		.buttonStyle(PressScaleStyle())
		.onReceive(NotificationCenter.default.publisher(for: .profilePanelVisibilityDidChange)) { note in
			if let val = note.userInfo?["isOpen"] as? NSNumber {
				withAnimation(.easeInOut(duration: 0.30)) {
					self.isOpen = val.boolValue
				}
			}
		}
	}
}
