import SwiftUI
import StoreKit
import UIKit
import LinkPresentation
import FirebaseAnalytics

struct ProfileView: View {
	@StateObject private var viewModel = ProfileViewModel()
	@EnvironmentObject private var homeViewModel: HomeViewModel
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@ObservedObject private var subscriptionStatus = SubscriptionStatus.shared
	@ObservedObject private var featureFlags = FeatureFlagsManager.shared
	
	@State private var navigateToAuth          = false
	@State private var showConfirmationDialog  = false
	@State private var showOnboardingRestart   = false
	@State private var showDomainSelection     = false
	@State private var showPremium             = false
	@Environment(\.presentationMode) private var presentationMode
	@Environment(\.colorScheme) var colorScheme
	
	private let layoutScale: CGFloat = 0.90
	
	private var largeFontSize: CGFloat { 17 * layoutScale }
	private var mediumFontSize: CGFloat { 14 * layoutScale }
	private var smallFontSize: CGFloat { 10 * layoutScale }
	private var rowSpacing: CGFloat { 16 * layoutScale }
	private var sectionSpacing: CGFloat { 20 * layoutScale }
	private var iconWidth: CGFloat { 20 * layoutScale }
	private var rowVerticalPadding: CGFloat { 7 * layoutScale }
	private var toggleHeight: CGFloat { 20 * layoutScale }
	private var scrollPadding: CGFloat { 16 * layoutScale }
	private var scrollHorizontalPadding: CGFloat { 30 * layoutScale }
	private var bottomStackSpacing: CGFloat { 8 * layoutScale }
	private var bottomPaddingTop: CGFloat { 8 * layoutScale }
	private var bottomPaddingBottom: CGFloat { 12 * layoutScale }
	private var deleteAccountPaddingVertical: CGFloat { 8 * layoutScale }
	private var chevronFontSize: CGFloat { 12 * layoutScale }
	
	var body: some View {
		ZStack {
			profileBackground
				.ignoresSafeArea()
			
			VStack(spacing: 0) {
				ScrollView {
					VStack(alignment: .leading, spacing: sectionSpacing) {
						profileRow(
							icon: "envelope.fill",
							label: "Email",
							value: truncatedEmail(viewModel.email)
						)
						
						toggleRow(
							icon: "bell.fill",
							label: "Notifications",
							isOn: $viewModel.notificationsEnabled
						)
						.alert(
							"Update App Permissions",
							isPresented: $viewModel.showSystemNotificationAlert
						) {
							Button("Open Settings") {
								Analytics.logEvent("profile_open_settings", parameters: [:])
								viewModel.openSystemSettings()
							}
							Button("Cancel", role: .cancel) { }
						} message: {
							Text("Notifications for Foreword are disabled at the system level. Please enable them in Settings.")
						}
						
						if featureFlags.isAutoplayEnabled {
							toggleRow(
								icon: "play.circle.fill",
								label: "Autoplay",
								isOn: $viewModel.autoplayMediaEnabled
							)
							.onChange(of: viewModel.autoplayMediaEnabled) { isOn in
								let generator = UIImpactFeedbackGenerator(style: .light)
								generator.impactOccurred()
								
								Analytics.logEvent("profile_autoplay_media_toggle", parameters: [
									"screen": "profile" as NSString,
									"enabled": NSNumber(value: isOn),
									"trigger": "tap" as NSString,
									"topic_id": (homeViewModel.selectedDomain?.id ?? "") as NSString,
									"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
								])
							}
						}
						
						toggleRow(
							icon: "eye.slash.fill",
							label: "Spoilers",
							isOn: $viewModel.spoilerProtectionEnabled
						)
						.onChange(of: viewModel.spoilerProtectionEnabled) { isOn in
							let generator = UIImpactFeedbackGenerator(style: .light)
							generator.impactOccurred()
							
							Analytics.logEvent("profile_spoiler_toggle", parameters: [
								"screen": "profile" as NSString,
								"enabled": NSNumber(value: isOn),
								"trigger": "tap" as NSString,
								"topic_id": (homeViewModel.selectedDomain?.id ?? "") as NSString,
								"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
							])
						}
						
						launchDestinationRow(
							label: "Launch Page"
						)
						
						if featureFlags.isPremiumSubscriptionEnabled {
							premiumRow()
						}
						
						Button {
							Analytics.logEvent("onboarding_restart_begin", parameters: [:])
							showDomainSelection = true
						} label: {
							HStack(spacing: rowSpacing) {
								Image(systemName: "gauge.with.needle.fill")
									.foregroundColor(.gray)
									.frame(width: iconWidth)
								Text("Customize")
								Spacer()
								Image(systemName: "arrowtriangle.forward.fill")
									.foregroundColor(Color.accentSecondary)
									.scaleEffect(x: 0.5, y: 0.8)
							}
							.padding(.vertical, rowVerticalPadding)
						}
						
						Button {
							let generator = UIImpactFeedbackGenerator(style: .light)
							generator.impactOccurred()
							
							Analytics.logEvent("profile_onboarding_tour_tap", parameters: [
								"screen": "profile" as NSString
							])
							
							NotificationCenter.default.post(name: .startOnboardingFromProfile, object: nil)
						} label: {
							HStack(spacing: rowSpacing) {
								Image(systemName: "map.fill")
									.foregroundColor(.gray)
									.frame(width: iconWidth)
								Text("Onboarding")
								Spacer()
								Image(systemName: "arrowtriangle.forward.fill")
									.foregroundColor(Color.accentSecondary)
									.scaleEffect(x: 0.5, y: 0.8)
							}
							.padding(.vertical, rowVerticalPadding)
						}
						
						Button {
							Analytics.logEvent("profile_bookmarks_open", parameters: [:])
							homeViewModel.showBookmarks()
							NotificationCenter.default.post(name: .didSelectBookmarks, object: nil)
							presentationMode.wrappedValue.dismiss()
						} label: {
							HStack(spacing: rowSpacing) {
								Image(systemName: "hand.thumbsup.fill")
									.foregroundColor(.gray)
									.frame(width: iconWidth)
								Text("Liked")
								Spacer()
								Image(systemName: "arrowtriangle.forward.fill")
									.foregroundColor(Color.accentSecondary)
									.scaleEffect(x: 0.5, y: 0.8)
							}
							.padding(.vertical, rowVerticalPadding)
						}
						.disabled(!viewModel.hasBookmarks)
						.opacity(viewModel.hasBookmarks ? 1 : 0.3)
						
						navigationLinkRow(
							icon: "text.page.fill",
							label: "Legal",
							destination: LegalView(),
							arrowColor: Color.accentSecondary,
							eventName: "profile_nav_legal_open"
						)
						
						shareButton()
						logoutButton()
					}
					.padding(.horizontal, scrollHorizontalPadding)
					.padding(.vertical, scrollPadding)
				}
				
				VStack(spacing: bottomStackSpacing) {
					deleteAccountButton()
					appVersionLabel()
				}
				.padding(.horizontal, scrollPadding)
				.padding(.top, bottomPaddingTop)
				.padding(.bottom, bottomPaddingBottom)
			}
		}
		.font(.custom("Avenir", size: largeFontSize))
		.foregroundColor(.primary)
		.navigationBarBackButtonHidden(true)
		.customNavigation(title: "Profile")
		.onAppear {
			viewModel.loadPreferences()
			Analytics.logEvent("profile_view_appear", parameters: [:])
		}
		.fullScreenCover(isPresented: $showDomainSelection) {
			NavigationStack {
				DomainSelectionView {
					showDomainSelection = false
				}
				.environmentObject(servicesLocator)
			}
		}
		.fullScreenCover(isPresented: $showOnboardingRestart) {
			NavigationStack {
				OnboardingCoordinator()
					.environmentObject(servicesLocator)
					.environmentObject(homeViewModel)
			}
		}
		.fullScreenCover(isPresented: $showPremium) {
			PremiumView()
		}
		.swipeBack()
	}
	
	private var profileBackground: Color {
		if colorScheme == .dark {
			return Color(UIColor.tertiarySystemBackground)
		}
		return Color(UIColor.systemBackground)
	}
	
	// ─────────── Launch destination ───────────
	private func setLaunchDestination(_ newValue: LaunchDestination, trigger: String) {
		guard viewModel.launchDestination != newValue else { return }
		
		let generator = UIImpactFeedbackGenerator(style: .light)
		generator.impactOccurred()
		
		Analytics.logEvent("profile_launch_destination_change", parameters: [
			"screen": "profile" as NSString,
			"trigger": trigger as NSString,
			"value": newValue.rawValue as NSString,
			"topic_id": (homeViewModel.selectedDomain?.id ?? "") as NSString,
			"card_id": (homeViewModel.currentCard?.id ?? "") as NSString
		])
		
		viewModel.launchDestination = newValue
		
		NotificationCenter.default.post(
			name: .launchDestinationPreferenceDidChange,
			object: nil,
			userInfo: [
				"value": newValue.rawValue as NSString,
				"trigger": trigger as NSString
			]
		)
	}
	
	private func launchDestinationRow(label: String) -> some View {
		let isCategories = (viewModel.launchDestination == .categories)
		let iconName = isCategories
		? "square.grid.2x2.fill"
		: "rectangle.portrait.on.rectangle.portrait.angled.fill"
		
		return HStack(spacing: rowSpacing) {
			Button {
				let next: LaunchDestination = isCategories ? .cards : .categories
				setLaunchDestination(next, trigger: "icon_toggle")
			} label: {
				Image(systemName: iconName)
					.foregroundColor(.gray)
					.frame(width: iconWidth)
			}
			.buttonStyle(.plain)
			
			Text(label)
			
			Spacer()
			
			Menu {
				ForEach(LaunchDestination.allCases) { option in
					Button {
						setLaunchDestination(option, trigger: "menu_select")
					} label: {
						Text(option.displayName)
					}
				}
			} label: {
				HStack(spacing: 6 * layoutScale) {
					Text(viewModel.launchDestination.displayName)
						.font(.custom("Avenir", size: mediumFontSize))
						.foregroundColor(.secondary)
					Image(systemName: "chevron.up.chevron.down")
						.font(.system(size: chevronFontSize, weight: .semibold))
						.foregroundColor(.secondary)
				}
				.contentShape(Rectangle())
			}
			.buttonStyle(.plain)
		}
		.padding(.vertical, rowVerticalPadding)
	}
	
	private func profileRow(icon: String, label: String, value: String) -> some View {
		HStack(spacing: rowSpacing) {
			Image(systemName: icon)
				.foregroundColor(.gray)
				.frame(width: iconWidth)
			Text(label)
			Spacer()
			Text(value)
				.foregroundColor(Color.accentPrimary)
				.lineLimit(1)
				.truncationMode(.middle)
				.minimumScaleFactor(0.8)
		}
		.padding(.vertical, rowVerticalPadding)
	}
	
	private func toggleRow(icon: String, label: String, isOn: Binding<Bool>) -> some View {
		HStack(spacing: rowSpacing) {
			Image(systemName: icon)
				.foregroundColor(.gray)
				.frame(width: iconWidth)
			Text(label)
			Spacer()
			Toggle("", isOn: isOn)
				.toggleStyle(SwitchToggleStyle(tint: Color.accentPrimary))
				.labelsHidden()
				.frame(height: toggleHeight)
		}
		.padding(.vertical, rowVerticalPadding)
	}
	
	private func premiumRow() -> some View {
		Button {
			let generator = UIImpactFeedbackGenerator(style: .light)
			generator.impactOccurred()
			
			Analytics.logEvent("profile_premium_tap", parameters: [
				"screen": "profile" as NSString,
				"status": (subscriptionStatus.isPremiumUser ? "premium" : "free") as NSString
			])
			
			showPremium = true
		} label: {
			HStack(spacing: rowSpacing) {
				Image(systemName: "crown.fill")
					.foregroundColor(Color.gray)
					.frame(width: iconWidth)
				Text("Foreword+")
				Spacer()
				Text(subscriptionStatus.isPremiumUser ? "Manage" : "Subscribe")
					.font(.custom("Avenir", size: mediumFontSize))
					.foregroundColor(.secondary)
				Image(systemName: "arrowtriangle.forward.fill")
					.foregroundColor(Color.accentSecondary)
					.scaleEffect(x: 0.5, y: 0.8)
			}
			.padding(.vertical, rowVerticalPadding)
		}
	}
	
	private func navigationLinkRow<Destination: View>(
		icon: String,
		label: String,
		destination: Destination,
		arrowColor: Color,
		eventName: String
	) -> some View {
		NavigationLink(destination: destination) {
			HStack(spacing: rowSpacing) {
				Image(systemName: icon)
					.foregroundColor(.gray)
					.frame(width: iconWidth)
				Text(label)
				Spacer()
				Image(systemName: "arrowtriangle.forward.fill")
					.foregroundColor(arrowColor)
					.scaleEffect(x: 0.5, y: 0.8)
			}
			.padding(.vertical, rowVerticalPadding)
		}
		.simultaneousGesture(TapGesture().onEnded {
			Analytics.logEvent(eventName, parameters: [:])
		})
	}
	
	private func logoutButton() -> some View {
		Button {
			Analytics.logEvent("profile_logout_tap", parameters: [:])
			viewModel.logout()
		} label: {
			HStack(spacing: rowSpacing) {
				Image(systemName: "rectangle.portrait.and.arrow.right")
					.foregroundColor(.red)
					.frame(width: iconWidth)
				Text("Log Out")
				Spacer()
				Image(systemName: "arrowtriangle.forward.fill")
					.foregroundColor(Color.accentSecondary)
					.scaleEffect(x: 0.5, y: 0.8)
			}
			.padding(.vertical, rowVerticalPadding)
		}
	}
	
	private func shareButton() -> some View {
		Button {
			let generator = UIImpactFeedbackGenerator(style: .light)
			generator.impactOccurred()
			Analytics.logEvent("profile_share_tap", parameters: [:])
			let shareURL = URL(string: "https://appstore.ponder-app.ai/")!
			let activityVC = UIActivityViewController(activityItems: [shareURL], applicationActivities: nil)
			if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
			   let rootVC = windowScene.windows.first?.rootViewController {
				rootVC.present(activityVC, animated: true)
			}
		} label: {
			HStack(spacing: rowSpacing) {
				Image(systemName: "square.and.arrow.up.fill")
					.foregroundColor(.gray)
					.frame(width: iconWidth)
				Text("Share Foreword")
				Spacer()
				Image(systemName: "arrowtriangle.forward.fill")
					.foregroundColor(Color.accentSecondary)
					.scaleEffect(x: 0.5, y: 0.8)
			}
			.padding(.vertical, rowVerticalPadding)
		}
	}
	
	private func deleteAccountButton() -> some View {
		Button("Delete Account") {
			Analytics.logEvent("profile_delete_account_tap", parameters: [
				"screen": "profile" as NSString
			])
			showConfirmationDialog = true
		}
		.foregroundColor(.red)
		.font(.custom("Avenir", size: largeFontSize))
		.frame(maxWidth: .infinity)
		.multilineTextAlignment(.center)
		.padding(.vertical, deleteAccountPaddingVertical)
		.alert("Are you sure?", isPresented: $showConfirmationDialog) {
			Button("Delete Account", role: .destructive) { viewModel.deleteAccount() }
			Button("Cancel", role: .cancel) { }
		} message: {
			Text("This action will permanently delete your account and cannot be undone.")
		}
	}
	
	private func appVersionLabel() -> some View {
		Text(appVersionString)
			.font(.custom("Avenir", size: smallFontSize))
			.frame(maxWidth: .infinity)
			.multilineTextAlignment(.center)
	}
	
	private var appVersionString: String {
		let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
		let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String
		if let build {
			return "Version \(short) (\(build))"
		}
		return "Version \(short)"
	}
	
	private func truncatedEmail(_ email: String) -> String {
		let parts = email.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false)
		guard parts.count == 2 else { return email }
		let local = String(parts[0])
		let domain = String(parts[1])
		let prefix = local.prefix(3)
		return "\(prefix)...@\(domain)"
	}
}

extension Notification.Name {
	static let triggerHomeOnboarding = Notification.Name("triggerHomeOnboarding")
}
