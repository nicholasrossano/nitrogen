import SwiftUI
import FirebaseAuth
import FirebaseFirestore
import FirebaseAnalytics

struct RootView: View {
	
	@StateObject private var servicesLocator = AppServicesLocator.shared
	@EnvironmentObject var homeViewModel: HomeViewModel
	
	@State private var showSplash    = true
	@State private var isInitialized = false
	@State private var isSignedIn    = false
	@State private var authHandle: AuthStateDidChangeListenerHandle?
	
	@State private var shouldShowOnboarding = false
	@State private var presentedOnboardingForUid: String?
	
	@State private var hasPresentedAuthViewThisSession = false
	@State private var didReceiveUserDidAuthenticate   = false
	
	@State private var hasStartedWarmBootThisLaunch = false
	
	var body: some View {
		NavigationStack {
			Group {
				if showSplash {
					Image("LaunchScreen")
						.resizable()
						.aspectRatio(contentMode: .fill)
						.frame(width: UIScreen.main.bounds.width)
						.clipped()
						.ignoresSafeArea()
					
				} else if !isInitialized {
					MorphingContoursView()
						.frame(width: 550, height: 550)
						.frame(maxWidth: .infinity, maxHeight: .infinity)
					
				} else if !isSignedIn {
					AuthView()
						.navigationBarBackButtonHidden(true)
						.onAppear {
							hasPresentedAuthViewThisSession = true
							didReceiveUserDidAuthenticate   = false
						}
					
				} else if hasPresentedAuthViewThisSession && !didReceiveUserDidAuthenticate {
					MorphingContoursView()
						.frame(width: 550, height: 550)
						.frame(maxWidth: .infinity, maxHeight: .infinity)
					
				} else if isSignedIn && shouldShowOnboarding {
					OnboardingCoordinator()
						.environmentObject(servicesLocator)
						.environmentObject(homeViewModel)
						.environmentObject(OnboardingManager.shared)
						.onAppear {
							Analytics.logEvent("onboarding_presented", parameters: [
								"screen": "root" as NSString
							])
						}
					
				} else {
					MainContainerView()
						.navigationBarBackButtonHidden(true)
						.interactiveDismissDisabled(true)
				}
			}
			.environmentObject(servicesLocator)
		}
		.onAppear {
			if authHandle == nil {
				authHandle = Auth.auth().addStateDidChangeListener { _, user in
					if let user = user {
						Analytics.setUserID(user.uid)
						isSignedIn = true
						
						servicesLocator.loginUser()
						warmBootHomeIfPossible(trigger: "auth_state_listener")
						
						homeViewModel.prefetchRecommendationsEarly(limit: 200)
						
					} else {
						Analytics.setUserID(nil)
						isSignedIn = false
						shouldShowOnboarding = false
						presentedOnboardingForUid = nil
						didReceiveUserDidAuthenticate = false
						hasPresentedAuthViewThisSession = false
						hasStartedWarmBootThisLaunch = false
					}
					isInitialized = true
				}
			}
			
			// If the user is already signed in on cold launch, start work immediately (during splash).
			if Auth.auth().currentUser != nil {
				warmBootHomeIfPossible(trigger: "root_on_appear_current_user")
			}
			
			DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
				withAnimation { showSplash = false }
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .triggerOnboarding)) { note in
			guard isSignedIn else { return }
			let isNew = (note.userInfo?["is_new_user"] as? NSNumber)?.boolValue == true
			let uid   = (note.userInfo?["uid"] as? String) ?? Auth.auth().currentUser?.uid
			guard isNew, let uid else { return }
			guard presentedOnboardingForUid != uid else { return }
			presentedOnboardingForUid = uid
			shouldShowOnboarding = true
		}
		.onReceive(NotificationCenter.default.publisher(for: .didCompleteOnboarding)) { _ in
			shouldShowOnboarding = false
			if let uid = Auth.auth().currentUser?.uid {
				Firestore.firestore().collection("users").document(uid)
					.setData(["onboarded": true], merge: true)
			}
		}
		.onReceive(NotificationCenter.default.publisher(for: .userDidAuthenticate)) { _ in
			didReceiveUserDidAuthenticate = true
		}
		.onReceive(NotificationCenter.default.publisher(for: .userDidLogout)) { _ in
			let generator = UIImpactFeedbackGenerator(style: .heavy)
			generator.impactOccurred()
			
			withAnimation(.easeInOut(duration: 0.3)) {
				shouldShowOnboarding = false
			}
			presentedOnboardingForUid = nil
			isSignedIn = false
			didReceiveUserDidAuthenticate = false
			hasPresentedAuthViewThisSession = false
			hasStartedWarmBootThisLaunch = false
		}
		.onDisappear {
			if let handle = authHandle {
				Auth.auth().removeStateDidChangeListener(handle)
				authHandle = nil
			}
		}
	}
	
	// ─────────── Section Header ───────────
	private func warmBootHomeIfPossible(trigger: String) {
		guard !hasStartedWarmBootThisLaunch else { return }
		guard Auth.auth().currentUser != nil else { return }
		
		hasStartedWarmBootThisLaunch = true
		
		let prefsCount = NSNumber(value: servicesLocator.userService.user?.domainPreferences.count ?? 0)
		
		Analytics.logEvent("home_warm_boot_start", parameters: [
			"screen": "root" as NSString,
			"trigger": trigger as NSString,
			"prefs_count": prefsCount
		])
		
		// 1) Start domains fetch immediately (overlaps with splash)
		homeViewModel.fetchAllDomains()
		
		// 2) Kick a For You build immediately so the card fetch overlaps with splash too.
		// If prefs arrive later, HomeViewModel already refetches on prefs-change.
		homeViewModel.reloadHomeAfterDomainPreferencesChange()
		
		Analytics.logEvent("home_warm_boot_kicked", parameters: [
			"screen": "root" as NSString,
			"trigger": trigger as NSString
		])
	}
}
