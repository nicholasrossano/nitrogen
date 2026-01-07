// CuratorInputBar.swift

import SwiftUI
import FirebaseAnalytics

struct CuratorInputBar: View {
	enum Mode {
		case trigger(showCurator: Binding<Bool>, associatedCard: Card?)
		case input(text: Binding<String>,
				   hintText: String?,
				   onSubmitted: (String) -> Void,
				   onVoiceTap: () -> Void,
				   showDismiss: Bool,
				   onDismiss: (() -> Void)?,
				   analyticsParams: [String: Any]?)
	}
	
	private let mode: Mode
	
	private let borderRadius: CGFloat = 30
	private let verticalPad : CGFloat = 12
	private let horizontalPad: CGFloat = 20
	private let iconTrailingPad: CGFloat = 10
	private var accentColor: Color { Color.accentSecondary }
	
	private let submitLabel: SubmitLabel
	
	@EnvironmentObject private var homeViewModel: HomeViewModel
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@FocusState private var isFieldFocused: Bool
	
	// ─────────── Section Header ───────────
	private var isTriggerMode: Bool {
		if case .trigger = mode { return true } else { return false }
	}
	private var shadowColor: Color { .clear }
	private var shadowRadius: CGFloat { 0 }
	private var shadowY: CGFloat { 0 }
	
	init(showCurator: Binding<Bool>, associatedCard: Card? = nil) {
		self.mode = .trigger(showCurator: showCurator, associatedCard: associatedCard)
		self.submitLabel = .send
	}
	
	init(text: Binding<String>,
		 hintText: String? = nil,
		 onSubmitted: @escaping (String) -> Void,
		 onVoiceTap: @escaping () -> Void = {},
		 submitLabel: SubmitLabel = .send) {
		self.mode = .input(text: text,
						   hintText: hintText,
						   onSubmitted: onSubmitted,
						   onVoiceTap: onVoiceTap,
						   showDismiss: false,
						   onDismiss: nil,
						   analyticsParams: nil)
		self.submitLabel = submitLabel
	}
	
	init(text: Binding<String>,
		 hintText: String? = nil,
		 onSubmitted: @escaping (String) -> Void,
		 onVoiceTap: @escaping () -> Void = {},
		 showDismiss: Bool,
		 onDismiss: @escaping () -> Void,
		 analyticsParams: [String: Any]? = nil,
		 submitLabel: SubmitLabel = .send) {
		self.mode = .input(text: text,
						   hintText: hintText,
						   onSubmitted: onSubmitted,
						   onVoiceTap: onVoiceTap,
						   showDismiss: showDismiss,
						   onDismiss: onDismiss,
						   analyticsParams: analyticsParams)
		self.submitLabel = submitLabel
	}
	
	var body: some View {
		switch mode {
		case .trigger(let showCurator, let associatedCard):
			styledPill { triggerPill(showCurator, associatedCard) }
			
		case .input(let textBinding, let hint, let submit, let onVoiceTap, let showDismiss, let onDismiss, let analyticsParams):
			if showDismiss {
				HStack(spacing: 8) {
					curatorDismissButton(
						onDismiss: onDismiss,
						analyticsParams: analyticsParams
					)
					styledPill {
						inputPill(textBinding: textBinding,
								  hint: hint,
								  submit: submit,
								  onVoiceTap: onVoiceTap)
					}
				}
			} else {
				styledPill {
					inputPill(textBinding: textBinding,
							  hint: hint,
							  submit: submit,
							  onVoiceTap: onVoiceTap)
				}
			}
		}
	}
	
	// ─────────── Section Header ───────────
	@ViewBuilder
	private func styledPill<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
		content()
			.foregroundStyle(.primary)
			.clipShape(RoundedRectangle(cornerRadius: borderRadius, style: .continuous))
			.background(
				Group {
					if #available(iOS 26.0, *) {
						RoundedRectangle(cornerRadius: borderRadius).glassEffect()
					} else {
						RoundedRectangle(cornerRadius: borderRadius).fill(.ultraThinMaterial)
					}
				}
			)
			.overlay(
				Group {
					if #available(iOS 26.0, *) {
						EmptyView()
					} else {
						RoundedRectangle(cornerRadius: borderRadius)
							.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
					}
				}
			)
			.contentShape(Rectangle())
			.tourTag("curator_inputBar")
			.accessibilityAddTraits(.isButton)
			.shadow(color: shadowColor, radius: shadowRadius, x: 0, y: shadowY)
	}
	
	// ─────────── Section Header ───────────
	@ViewBuilder
	private func curatorDismissButton(onDismiss: (() -> Void)?,
									  analyticsParams: [String: Any]?) -> some View {
		let side = UIScreen.main.bounds.width * 0.10
		let symbol = "xmark"
		
		CloseButton(systemName: symbol, size: side) {
			UIImpactFeedbackGenerator(style: .light).impactOccurred()
			
			var screen = "curator"
			if let s = analyticsParams?["screen"] as? String {
				screen = s
			} else if let s = analyticsParams?["screen"] as? NSString {
				screen = s as String
			}
			let closeEvent  = (screen == "search") ? "search_close_tap" : "curator_close_tap"
			
			var params: [String: Any] = [
				"screen": screen as NSString,
				"trigger": "x_button" as NSString
			]
			if let extras = analyticsParams {
				for (k, v) in extras { params[k] = v }
			}
			Analytics.logEvent(closeEvent, parameters: params)
			
			isFieldFocused = false
			onDismiss?()
		}
		.accessibilityLabel("Dismiss")
	}
	
	@ViewBuilder
	private func triggerPill(_ showCurator: Binding<Bool>,
							 _ associatedCard: Card?) -> some View {
		let voiceEnabled = FeatureFlagsManager.shared.isVoiceModeEnabled
		
		HStack(spacing: 0) {
			Text("Ask follow-up questions")
				.font(.custom("Avenir", size: 14))
				.foregroundColor(Color.white.opacity(0.8))
				.padding(.vertical, verticalPad)
				.padding(.leading, horizontalPad)
				.frame(maxWidth: .infinity, alignment: .leading)
				.contentShape(Rectangle())
				.onTapGesture {
					CuratorView.prepareNextLaunchFocus(shouldFocus: true, trigger: "input_bar")
					openCurator(showCurator,
								associatedCard: associatedCard,
								voice: false)
				}
		}
	}
	
	@ViewBuilder
	private func inputPill(textBinding: Binding<String>,
						   hint: String?,
						   submit: @escaping (String) -> Void,
						   onVoiceTap: @escaping () -> Void) -> some View {
		let voiceEnabled = FeatureFlagsManager.shared.isVoiceModeEnabled
		let showMic      = textBinding.wrappedValue.isEmpty && voiceEnabled
		
		ZStack {
			if textBinding.wrappedValue.isEmpty {
				Text(hint ?? "Ask follow-up questions")
					.font(.custom("Avenir", size: 14))
					.foregroundColor(Color.white.opacity(0.8))
					.frame(maxWidth: .infinity, alignment: .leading)
					.padding(.leading, horizontalPad)
			}
			
			HStack {
				TextField("", text: textBinding)
					.focused($isFieldFocused)
					.textFieldStyle(PlainTextFieldStyle())
					.submitLabel(submitLabel)
					.onSubmit {
						if !textBinding.wrappedValue.isEmpty {
							submit(textBinding.wrappedValue)
							textBinding.wrappedValue = ""
						}
					}
					.padding(.horizontal, horizontalPad)
					.padding(.vertical, verticalPad)
					.font(.custom("Avenir", size: 14))
					.foregroundColor(.primary)
					.accentColor(accentColor)
			}
		}
		.onAppear {
			let (shouldFocus, trigger) = CuratorView.consumeNextLaunchFocus()
			DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) {
				isFieldFocused = shouldFocus
			}
			var params: [String: Any] = [
				"screen": "curator" as NSString,
				"should_focus": NSNumber(value: shouldFocus)
			]
			params["trigger"] = trigger as NSString
			Analytics.logEvent("curator_input_focus_state", parameters: params)
		}
	}
	
	private func openCurator(_ showCurator: Binding<Bool>,
							 associatedCard: Card?,
							 voice: Bool) {
		UIImpactFeedbackGenerator(style: .light).impactOccurred()
		
		if voice { CuratorView.nextLaunchVoice = true }
		
		servicesLocator.visibilityNotifier.priorMode = servicesLocator.visibilityNotifier.mode
		servicesLocator.visibilityNotifier.mode      = .curatorMode
		
		if let associatedCard {
			homeViewModel.currentCard = associatedCard
		}
		showCurator.wrappedValue    = true
	}
}

extension View {
	func curatorPillMatched(in ns: Namespace.ID) -> some View {
		self.matchedGeometryEffect(
			id: "CuratorInputBar",
			in: ns,
			properties: [.position, .frame]
		)
	}
}

private struct CuratorNamespaceKey: EnvironmentKey {
	static let defaultValue: Namespace.ID? = nil
}

extension EnvironmentValues {
	var curatorNamespace: Namespace.ID? {
		get { self[CuratorNamespaceKey.self] }
		set { self[CuratorNamespaceKey.self] = newValue }
	}
}
