import SwiftUI
import Combine

enum OnboardingFlow: Hashable, CaseIterable {
	case home
	case shareUpdate
	case firstLike
	
	var storageId: String {
		switch self {
		case .home: return "home"
		case .shareUpdate: return "share_update"
		case .firstLike: return "first_like"
		}
	}
}

struct OnboardingStep: Identifiable, Hashable {
	let id: String
	let text: String
	let anchorIds: [String]
	
	init(id: String, text: String, anchorIds: [String]? = nil) {
		self.id = id
		self.text = text
		self.anchorIds = anchorIds ?? [id]
	}
}

@MainActor
final class OnboardingManager: ObservableObject {
	static let shared = OnboardingManager()
	
	@Published var currentFlow: OnboardingFlow?
	@Published var stepIndex: Int = 0
	@Published var anchors: [String: Anchor<CGRect>] = [:]
	
	private(set) var flows: [OnboardingFlow: [OnboardingStep]] = [
		.home: [
			.init(
				id: "domain_grid_card_tile",
				text: "Each shelf shows previews of the cards in that category. Tap one to jump straight to that card in that category's deck."
			),
			.init(
				id: "domain_grid_customize_and_star",
				text: "Favorite categories to curate your For You cards. Use the Customize flow to tune your preferences further to help us tailor content for you.",
				anchorIds: ["domain_grid_customize_button", "domain_grid_top_star"]
			),
			.init(
				id: "home_card",
				text: "Swipe through the cards for the latest highlights. Swipe left for the next card, and right for the previous card."
			),
			.init(
				id: "home_action_capsule",
				text: "Open sources, share a card, and like or dislike cards to better curate your feed. You can see all your likes in the side menu."
			),
			.init(
				id: "home_nav_capsule",
				text: "Use the gear icon to open the side menu and the other to toggle between the cards view and the category view."
			),
			.init(
				id: "curator_inputBar",
				text: "Ask the Curator follow-up questions to dive deeper into the current card."
			)
		],
		.shareUpdate: [
			.init(
				id: "home_action_capsule",
				text: "We've updated the sharing capability! Try it out with the arrow button in the action capsule."
			)
		],
		.firstLike: [
			.init(
				id: "home_action_capsule",
				text: "Likes and dislikes help us better curate your cards! You can find all your likes in the side menu."
			)
		]
	]
	
	private let seenKey = "foreword.onboarding.seen"
	private let shareUpdateCountKey = "foreword.onboarding.shareUpdate.count"
	private let shareUpdateMaxCount = 3
	
	private init() {}
	
	// ─────────── Section Header ───────────
	func tryStart(flow: OnboardingFlow) -> Bool {
		guard currentFlow == nil else { return false }
		guard !hasSeen(flow: flow) else { return false }
		currentFlow = flow
		stepIndex   = 0
		return true
	}
	
	// ─────────── Section Header ───────────
	func start(flow: OnboardingFlow) {
		guard !hasSeen(flow: flow) else { return }
		currentFlow = flow
		stepIndex   = 0
	}
	
	// ─────────── Section Header ───────────
	func next() {
		guard let flow = currentFlow else { return }
		stepIndex += 1
		if stepIndex >= (flows[flow]?.count ?? 0) { complete(flow) }
	}
	
	// ─────────── Section Header ───────────
	func skip() { complete(currentFlow) }
	
	// ─────────── Section Header ───────────
	func reset(flow: OnboardingFlow) {
		if flow == .shareUpdate {
			UserDefaults.standard.set(0, forKey: shareUpdateCountKey)
			currentFlow = nil
			start(flow: flow)
			return
		}
		
		if flow == .firstLike {
			UserDefaults.standard.set(false, forKey: stableSeenKey(for: flow))
			currentFlow = nil
			start(flow: flow)
			return
		}
		
		var seen = seenFlows()
		seen.remove(flow)
		UserDefaults.standard.set(Array(seen.map(\.hashValue)), forKey: seenKey)
		start(flow: flow)
	}
	
	// ─────────── Section Header ───────────
	private func complete(_ flow: OnboardingFlow?) {
		guard let f = flow else { return }
		
		if f == .shareUpdate {
			let currentCount = UserDefaults.standard.integer(forKey: shareUpdateCountKey)
			UserDefaults.standard.set(currentCount + 1, forKey: shareUpdateCountKey)
		} else if f == .firstLike {
			UserDefaults.standard.set(true, forKey: stableSeenKey(for: f))
		} else {
			var seen = seenFlows()
			seen.insert(f)
			UserDefaults.standard.set(Array(seen.map(\.hashValue)), forKey: seenKey)
			
			if f == .home {
				OnboardingService.shared.markCompleted()
			}
		}
		
		currentFlow = nil
	}
	
	// ─────────── Section Header ───────────
	private func hasSeen(flow: OnboardingFlow) -> Bool {
		if flow == .shareUpdate {
			let count = UserDefaults.standard.integer(forKey: shareUpdateCountKey)
			return count >= shareUpdateMaxCount
		}
		
		if flow == .firstLike {
			return UserDefaults.standard.bool(forKey: stableSeenKey(for: flow))
		}
		
		return seenFlows().contains(flow)
	}
	
	// ─────────── Section Header ───────────
	private func stableSeenKey(for flow: OnboardingFlow) -> String {
		"foreword.onboarding.\(flow.storageId).seen"
	}
	
	// ─────────── Section Header ───────────
	private func seenFlows() -> Set<OnboardingFlow> {
		let raw = UserDefaults.standard.array(forKey: seenKey) as? [Int] ?? []
		return Set(raw.compactMap { hash in
			OnboardingFlow.allCases.first { $0.hashValue == hash }
		})
	}
}
