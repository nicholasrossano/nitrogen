import SwiftUI
import FirebaseAnalytics
import UIKit

struct OnboardingOverlay: View {
	@EnvironmentObject private var manager: OnboardingManager
	@Namespace private var anim
	
	private let bannerExtraSpacing: CGFloat = 20
	
	var body: some View {
		if let flow = manager.currentFlow,
		   let step = currentStep(for: flow) {
			GeometryReader { geo in
				let targets: [(id: String, rect: CGRect)] = step.anchorIds.compactMap { anchorId in
					manager.anchors[anchorId].map { anchor in
						(id: anchorId, rect: geo[anchor])
					}
				}
				
				let containerWidth = geo.size.width * 0.95
				let containerY = geo.size.height * 0.75
				
				ZStack {
					Color.black.opacity(0.5).ignoresSafeArea()
					
					if targets.count == 1, let single = targets.first {
						highlight(for: single.id, rect: single.rect)
							.matchedGeometryEffect(id: "highlight", in: anim)
					} else {
						ForEach(targets, id: \.id) { item in
							highlight(for: item.id, rect: item.rect)
								.matchedGeometryEffect(id: "highlight_\(item.id)", in: anim)
						}
					}
					
					VStack(spacing: 10) {
						banner(text: step.text)
							.matchedGeometryEffect(id: "tooltip", in: anim)
						tourNav(stepId: step.id)
					}
					.frame(width: containerWidth)
					.position(x: geo.size.width / 2, y: containerY)
					.padding(.vertical, bannerExtraSpacing)
				}
				.animation(.easeInOut(duration: 0.25), value: step.id)
			}
			.transition(.opacity)
		}
	}
	
	// ─────────── Section Header ───────────
	@ViewBuilder
	private func tourNav(stepId: String) -> some View {
		if manager.currentFlow == .shareUpdate {
			shareUpdateNav(stepId: stepId)
		} else if manager.currentFlow == .firstLike {
			firstLikeNav(stepId: stepId)
		} else {
			defaultTourNav(stepId: stepId)
		}
	}
	
	// ─────────── Section Header ───────────
	private func defaultTourNav(stepId: String) -> some View {
		HStack(spacing: 22) {
			Button {
				guard manager.stepIndex > 0 else { return }
				
				let haptic = UIImpactFeedbackGenerator(style: .light)
				haptic.impactOccurred()
				
				Analytics.logEvent("onboarding_tour_nav_tap", parameters: [
					"screen": "onboarding_tour" as NSString,
					"action": "back" as NSString,
					"step_id": stepId as NSString,
					"card_id": "" as NSString,
					"topic_id": "" as NSString,
					"is_first_step": NSNumber(value: manager.stepIndex == 0)
				])
				withAnimation(.easeInOut(duration: 0.22)) {
					manager.stepIndex = max(0, manager.stepIndex - 1)
				}
			} label: {
				Image(systemName: "arrow.left.circle.fill")
					.font(.system(size: 18, weight: .regular))
					.imageScale(.medium)
					.foregroundColor(
						manager.stepIndex == 0
						? Color.gray.opacity(0.6)
						: .accentSecondary
					)
			}
			.buttonStyle(.plain)
			.disabled(manager.stepIndex == 0)
			
			Button {
				let haptic = UIImpactFeedbackGenerator(style: .light)
				haptic.impactOccurred()
				
				Analytics.logEvent("onboarding_tour_nav_tap", parameters: [
					"screen": "onboarding_tour" as NSString,
					"action": "skip" as NSString,
					"step_id": stepId as NSString,
					"card_id": "" as NSString,
					"topic_id": "" as NSString,
					"is_first_step": NSNumber(value: manager.stepIndex == 0)
				])
				manager.skip()
			} label: {
				Image(systemName: "x.circle.fill")
					.font(.system(size: 18, weight: .regular))
					.imageScale(.medium)
			}
			.buttonStyle(.plain)
			
			Button {
				let haptic = UIImpactFeedbackGenerator(style: .light)
				haptic.impactOccurred()
				
				Analytics.logEvent("onboarding_tour_nav_tap", parameters: [
					"screen": "onboarding_tour" as NSString,
					"action": "forward" as NSString,
					"step_id": stepId as NSString,
					"card_id": "" as NSString,
					"topic_id": "" as NSString,
					"is_first_step": NSNumber(value: manager.stepIndex == 0)
				])
				manager.next()
			} label: {
				Image(systemName: "arrow.right.circle.fill")
					.font(.system(size: 18, weight: .regular))
					.imageScale(.medium)
			}
			.buttonStyle(.plain)
		}
		.foregroundColor(.accentSecondary)
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
		.background(
			RoundedRectangle(cornerRadius: 50, style: .continuous)
				.fill(.ultraThinMaterial)
				.overlay(
					RoundedRectangle(cornerRadius: 50, style: .continuous)
						.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
				)
				.shadow(color: Color.black.opacity(0.15), radius: 3, x: 0, y: 1)
		)
		.accessibilityElement(children: .combine)
		.accessibilityLabel("Onboarding tour navigation")
	}
	
	// ─────────── Section Header ───────────
	private func shareUpdateNav(stepId: String) -> some View {
		HStack(spacing: 0) {
			Button {
				let haptic = UIImpactFeedbackGenerator(style: .light)
				haptic.impactOccurred()
				
				Analytics.logEvent("share_update_tour_nav_tap", parameters: [
					"screen": "home" as NSString,
					"action": "dismiss" as NSString,
					"step_id": stepId as NSString,
					"card_id": "" as NSString,
					"topic_id": "" as NSString
				])
				manager.skip()
			} label: {
				Image(systemName: "checkmark.circle.fill")
					.font(.system(size: 18, weight: .regular))
					.imageScale(.medium)
			}
			.buttonStyle(.plain)
		}
		.foregroundColor(.accentSecondary)
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
		.background(
			RoundedRectangle(cornerRadius: 50, style: .continuous)
				.fill(.ultraThinMaterial)
				.overlay(
					RoundedRectangle(cornerRadius: 50, style: .continuous)
						.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
				)
				.shadow(color: Color.black.opacity(0.15), radius: 3, x: 0, y: 1)
		)
		.accessibilityElement(children: .combine)
		.accessibilityLabel("Dismiss share update")
	}
	
	// ─────────── Section Header ───────────
	private func firstLikeNav(stepId: String) -> some View {
		HStack(spacing: 0) {
			Button {
				let haptic = UIImpactFeedbackGenerator(style: .light)
				haptic.impactOccurred()
				
				Analytics.logEvent("first_like_nudge_nav_tap", parameters: [
					"screen": "home" as NSString,
					"action": "dismiss" as NSString,
					"step_id": stepId as NSString,
					"card_id": "" as NSString,
					"topic_id": "" as NSString
				])
				manager.skip()
			} label: {
				Image(systemName: "checkmark.circle.fill")
					.font(.system(size: 18, weight: .regular))
					.imageScale(.medium)
			}
			.buttonStyle(.plain)
		}
		.foregroundColor(.accentSecondary)
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
		.background(
			RoundedRectangle(cornerRadius: 50, style: .continuous)
				.fill(.ultraThinMaterial)
				.overlay(
					RoundedRectangle(cornerRadius: 50, style: .continuous)
						.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
				)
				.shadow(color: Color.black.opacity(0.15), radius: 3, x: 0, y: 1)
		)
		.accessibilityElement(children: .combine)
		.accessibilityLabel("Dismiss first like nudge")
	}
	
	// ─────────── Section Header ───────────
	private func firstDislikeNav(stepId: String) -> some View {
		HStack(spacing: 0) {
			Button {
				let haptic = UIImpactFeedbackGenerator(style: .light)
				haptic.impactOccurred()
				
				Analytics.logEvent("first_dislike_nudge_nav_tap", parameters: [
					"screen": "home" as NSString,
					"action": "dismiss" as NSString,
					"step_id": stepId as NSString,
					"card_id": "" as NSString,
					"topic_id": "" as NSString
				])
				manager.skip()
			} label: {
				Image(systemName: "checkmark.circle.fill")
					.font(.system(size: 18, weight: .regular))
					.imageScale(.medium)
			}
			.buttonStyle(.plain)
		}
		.foregroundColor(.accentSecondary)
		.padding(.horizontal, 16)
		.padding(.vertical, 10)
		.background(
			RoundedRectangle(cornerRadius: 50, style: .continuous)
				.fill(.ultraThinMaterial)
				.overlay(
					RoundedRectangle(cornerRadius: 50, style: .continuous)
						.stroke(Color.white.opacity(0.7), lineWidth: 0.5)
				)
				.shadow(color: Color.black.opacity(0.15), radius: 3, x: 0, y: 1)
		)
		.accessibilityElement(children: .combine)
		.accessibilityLabel("Dismiss first dislike nudge")
	}
	
	// ─────────── Section Header ───────────
	private func banner(text: String) -> some View {
		HStack(spacing: 8) {
			Image(systemName: "lightbulb.fill")
				.foregroundColor(.accentSecondary)
				.imageScale(.medium)
				.padding(.horizontal, 6)
			
			Text(text)
				.font(.subheadline)
				.foregroundColor(.primary)
			
			Spacer()
		}
		.frame(minHeight: 50, alignment: .leading)
		.padding(12)
		.background(
			RoundedRectangle(cornerRadius: 10, style: .continuous)
				.fill(.thinMaterial)
		)
		.shadow(color: Color.black.opacity(0.1), radius: 4, x: 0, y: 2)
		.padding(.horizontal)
	}
	
	private func currentStep(for flow: OnboardingFlow) -> OnboardingStep? {
		let steps = manager.flows[flow] ?? []
		guard manager.stepIndex < steps.count else { return nil }
		return steps[manager.stepIndex]
	}
	
	// ─────────── Section Header ───────────
	private func outwardGlow<S: Shape>(_ shape: S, lineWidth: CGFloat) -> some View {
		let blurLineWidth = max(lineWidth * 5.0, lineWidth + 3)
		
		let blurOpacity: Double = 0.9
		let stringOpacity: Double = 0.4
		let shadow1Opacity: Double = 0.5
		let shadow2Opacity: Double = 0.3
		
		return ZStack {
			shape
				.stroke(Color.beige.opacity(blurOpacity), lineWidth: blurLineWidth)
				.blur(radius: 10)
				.overlay(
					shape
						.fill(Color.black)
						.blendMode(.destinationOut)
				)
				.compositingGroup()
				.shadow(color: Color.beige.opacity(shadow1Opacity), radius: 14, x: 0, y: 0)
				.shadow(color: Color.beige.opacity(shadow2Opacity), radius: 22, x: 0, y: 0)
			
			shape
				.stroke(Color.beige.opacity(stringOpacity), lineWidth: lineWidth)
		}
	}
	
	private func highlight(for stepId: String, rect: CGRect) -> some View {
		let center = CGPoint(x: rect.midX, y: rect.midY)
		let size   = CGSize(width: rect.width, height: rect.height)
		
		switch stepId {
		case "home_domain_pill_row", "home_nav_capsule", "home_action_capsule", "domain_grid_customize_button":
			return AnyView(
				outwardGlow(Capsule(), lineWidth: 2)
					.frame(width: size.width, height: size.height)
					.position(center)
			)
		case "home_widget_icon", "domain_grid_top_star":
			let d = max(rect.width, rect.height)
			return AnyView(
				outwardGlow(Circle(), lineWidth: 3)
					.frame(width: d, height: d)
					.position(center)
			)
		case "home_card", "domain_grid_card_tile":
			return AnyView(
				outwardGlow(RoundedRectangle(cornerRadius: 20, style: .continuous), lineWidth: 3)
					.frame(width: rect.width, height: rect.height)
					.position(center)
			)
		case "domain_grid_top_shelf":
			return AnyView(
				outwardGlow(RoundedRectangle(cornerRadius: 16, style: .continuous), lineWidth: 3)
					.frame(width: rect.width, height: rect.height)
					.position(center)
			)
		default:
			return AnyView(
				outwardGlow(RoundedRectangle(cornerRadius: 24, style: .continuous), lineWidth: 3)
					.frame(width: rect.width, height: rect.height)
					.position(center)
			)
		}
	}
}
