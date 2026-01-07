import SwiftUI
import FirebaseAnalytics

struct OnboardingCoordinator: View {
	enum Step { case topics, tour }
	
	@Environment(\.dismiss) private var dismiss
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@EnvironmentObject private var homeViewModel : HomeViewModel
	@State private var step: Step = .topics
	
	var body: some View {
		ZStack {
			switch step {
			case .topics:
				NavigationStack {
					DomainSelectionView(onDone: {
						advance()
					})
					.environmentObject(servicesLocator)
					.environmentObject(homeViewModel)
					.environmentObject(OnboardingManager.shared)
					.navigationBarTitleDisplayMode(.inline)
				}
				
			case .tour:
				MainContainerView()
					.environmentObject(servicesLocator)
					.environmentObject(homeViewModel)
					.environmentObject(OnboardingManager.shared)
					.onAppear {
						OnboardingManager.shared.reset(flow: .home)
						Analytics.logEvent("onboarding_tour_show", parameters: [
							"screen": "onboarding_tour" as NSString
						])
					}
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private func advance() {
		switch step {
		case .topics:
			step = .tour
			NotificationCenter.default.post(name: .triggerHomeOnboarding, object: nil)
		case .tour:
			complete()
		}
	}
	
	// ─────────── Section Header ───────────
	private func complete() {
		Analytics.logEvent("onboarding_complete", parameters: [
			"screen": "onboarding" as NSString
		])
		OnboardingService.shared.markCompleted()
		dismiss()
	}
}
