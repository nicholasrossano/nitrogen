import SwiftUI
import FirebaseAnalytics

extension Notification.Name {
	static let didSelectBookmarks = Notification.Name("didSelectBookmarks")
	static let profilePanelVisibilityDidChange = Notification.Name("profilePanelVisibilityDidChange")
	static let startOnboardingFromProfile = Notification.Name("startOnboardingFromProfile")
	static let launchDestinationPreferenceDidChange = Notification.Name("launchDestinationPreferenceDidChange")
}

struct MainContainerView: View {
	@Environment(\.colorScheme) var colorScheme
	
	@State private var showProfile  = false
	@State private var hasAppeared = false
	
	private let screen = UIScreen.main.bounds
	private var profilePanelWidth: CGFloat { screen.width * 0.8 }
	
	var body: some View {
		ZStack(alignment: .leading) {
			
			if showProfile {
				ZStack {
					profilePanelBackground
						.ignoresSafeArea()
					
					NavigationView {
						ProfileView()
							.navigationBarHidden(true)
					}
					.navigationViewStyle(StackNavigationViewStyle())
					.background(profilePanelBackground)
				}
				.frame(width: profilePanelWidth)
				.clipped()
				.edgesIgnoringSafeArea(.all)
				.transition(.move(edge: .leading))
				.zIndex(0)
			}
			
			ZStack(alignment: .leading) {
				HomeView(onProfileToggle: {
					guard hasAppeared else { return }
					
					withAnimation(.easeInOut(duration: 0.3)) {
						showProfile.toggle()
					}
					notifyProfileVisibilityChanged(trigger: "profile_button")
				})
				.allowsHitTesting(!showProfile)
				
				if showProfile {
					Color.black.opacity(0.001)
						.frame(width: screen.width * 0.2, height: screen.height)
						.contentShape(Rectangle())
						.onTapGesture {
							let generator = UIImpactFeedbackGenerator(style: .heavy)
							generator.impactOccurred()
							
							withAnimation(.easeInOut(duration: 0.3)) {
								showProfile = false
							}
							notifyProfileVisibilityChanged(trigger: "overlay_tap")
						}
						.highPriorityGesture(
							DragGesture().onEnded { value in
								if value.translation.width < -50 {
									let generator = UIImpactFeedbackGenerator(style: .heavy)
									generator.impactOccurred()
									
									withAnimation(.easeInOut(duration: 0.3)) {
										showProfile = false
									}
									notifyProfileVisibilityChanged(trigger: "edge_swipe")
								}
							}
						)
				}
			}
			.offset(x: showProfile ? profilePanelWidth : 0)
			.compositingGroup()
			.shadow(
				color: Color.black.opacity(showProfile ? 0.5 : 0.05),
				radius: showProfile ? 12 : 3,
				x: showProfile ? -4 : 0,
				y: 0
			)
			.zIndex(1)
		}
		.onReceive(NotificationCenter.default.publisher(for: .didSelectBookmarks)) { _ in
			let generator = UIImpactFeedbackGenerator(style: .heavy)
			generator.impactOccurred()
			
			withAnimation(.easeInOut(duration: 0.3)) {
				showProfile = false
			}
			notifyProfileVisibilityChanged(trigger: "bookmarks_tap")
		}
		.onReceive(NotificationCenter.default.publisher(for: .userDidLogout)) { _ in
			let generator = UIImpactFeedbackGenerator(style: .heavy)
			generator.impactOccurred()
			
			withAnimation(.easeInOut(duration: 0.3)) {
				showProfile = false
			}
			notifyProfileVisibilityChanged(trigger: "logout_or_delete")
		}
		.onReceive(NotificationCenter.default.publisher(for: .startOnboardingFromProfile)) { _ in
			let generator = UIImpactFeedbackGenerator(style: .heavy)
			generator.impactOccurred()
			
			withAnimation(.easeInOut(duration: 0.3)) {
				showProfile = false
			}
			notifyProfileVisibilityChanged(trigger: "onboarding_tap")
			
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.32) {
				NotificationCenter.default.post(name: .triggerHomeOnboarding, object: nil)
			}
		}
		.onAppear {
			DispatchQueue.main.async { hasAppeared = true }
		}
		.overlay(
			OnboardingOverlay()
				.environmentObject(OnboardingManager.shared)
				.ignoresSafeArea()
		)
	}
	
	private var profilePanelBackground: Color {
		if colorScheme == .dark {
			return Color(UIColor.secondarySystemBackground)
		}
		return Color(UIColor.systemBackground)
	}
	
	// ─────────── Section Header ───────────
	private func notifyProfileVisibilityChanged(trigger: String) {
		NotificationCenter.default.post(
			name: .profilePanelVisibilityDidChange,
			object: nil,
			userInfo: ["isOpen": NSNumber(value: showProfile)]
		)
		
		let event = showProfile ? "home_profile_open" : "home_profile_close"
		Analytics.logEvent(event, parameters: [
			"screen": "home" as NSString,
			"trigger": trigger as NSString
		])
	}
}
