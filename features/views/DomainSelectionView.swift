import SwiftUI
import FirebaseAnalytics
import FirebaseFirestore
import FirebaseAuth

struct DomainSelectionView: View {
	private enum Step {
		case domains
		case categories
	}
	
	private enum TransitionDirection {
		case forward
		case backward
	}
	
	@EnvironmentObject private var servicesLocator: AppServicesLocator
	@EnvironmentObject private var homeViewModel: HomeViewModel
	
	let onDone: () -> Void
	
	@State private var domains: [Domain] = []
	@State private var step: Step = .domains
	@State private var selectedDomainIds: Set<String> = []
	@State private var selectedCategoriesByDomain: [String: Set<String>] = [:]
	@State private var expandedDomainIds: Set<String> = []
	@State private var transitionDirection: TransitionDirection = .forward
	
	init(onDone: @escaping () -> Void = {}) {
		self.onDone = onDone
	}
	
	// ─────────── Domain + Category helpers ───────────
	private var displayDomains: [Domain] {
		domains
			.filter { $0.display }
			.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
	}
	
	private var selectedDisplayDomains: [Domain] {
		displayDomains.filter { selectedDomainIds.contains($0.id) }
	}
	
	private var hasDomainSelection: Bool {
		!selectedDomainIds.isEmpty
	}
	
	private var canAdvance: Bool {
		switch step {
		case .domains:
			return hasDomainSelection
		case .categories:
			return true
		}
	}
	
	private var headerText: String {
		switch step {
		case .domains:
			return "Let's tune into your curiosity. Select your favorite categories so we can curate your For You page."
		case .categories:
			return "What categories witihin your favorites are you most interested in? We'll prioritize accordingly."
		}
	}
	
	private var stepTransition: AnyTransition {
		switch transitionDirection {
		case .forward:
			return .asymmetric(
				insertion: .move(edge: .trailing).combined(with: .opacity),
				removal: .move(edge: .leading).combined(with: .opacity)
			)
		case .backward:
			return .asymmetric(
				insertion: .move(edge: .leading).combined(with: .opacity),
				removal: .move(edge: .trailing).combined(with: .opacity)
			)
		}
	}
	
	// ─────────── Body ───────────
	var body: some View {
		GeometryReader { geo in
			let width = geo.size.width
			let contentWidth = width * 0.80
			let horizontalInset = (width - contentWidth) / 2
			let topSafe = geo.safeAreaInsets.top
			let domainHSpacing: CGFloat = 12
			
			ZStack {
				backgroundLayer
				
				ScrollView {
					VStack(spacing: 24) {
						Text(headerText)
							.font(.custom("Avenir", size: 16))
							.foregroundColor(.white)
							.multilineTextAlignment(.leading)
							.frame(maxWidth: .infinity, alignment: .leading)
							.padding(.top, topSafe + 16)
							.padding(.horizontal, horizontalInset)
						
						Spacer()
						
						ZStack {
							if step == .domains {
								let horizontalSpacing = domainHSpacing
								
								let groups: [[Domain]] = stride(from: 0, to: displayDomains.count, by: 3).map { start in
									let end = min(start + 3, displayDomains.count)
									return Array(displayDomains[start..<end])
								}
								
								VStack(alignment: .center, spacing: 14) {
									ForEach(Array(groups.enumerated()), id: \.offset) { _, row in
										HStack(spacing: horizontalSpacing) {
											ForEach(row, id: \.id) { domain in
												domainPill(for: domain)
											}
										}
									}
								}
								.frame(maxWidth: .infinity, alignment: .center)
								.padding(.horizontal, horizontalInset)
								.transition(stepTransition)
							} else {
								VStack(alignment: .leading, spacing: 28) {
									ForEach(selectedDisplayDomains, id: \.id) { domain in
										categoryRow(for: domain)
									}
								}
								.frame(maxWidth: .infinity, alignment: .leading)
								.padding(.horizontal, horizontalInset)
								.transition(stepTransition)
							}
						}
						
						Spacer()
					}
					.frame(minHeight: geo.size.height)
					.padding(.bottom, 80)
					.offset(x: -width * 0.05)
				}
			}
			.ignoresSafeArea(edges: .top)
		}
		.safeAreaInset(edge: .bottom) {
			GeometryReader { insetGeo in
				let width = insetGeo.size.width
				HStack {
					if step == .categories {
						Button {
							transitionDirection = .backward
							withAnimation(.easeInOut(duration: 0.45)) {
								step = .domains
							}
							Analytics.logEvent("domain_selection_back_to_domains", parameters: [
								"screen": "domain_selection" as NSString
							])
						} label: {
							Image(systemName: "arrow.left.circle.fill")
								.font(.system(size: 32, weight: .semibold))
						}
						.buttonStyle(.plain)
						.foregroundColor(Color.accentSecondary)
						.padding(.leading, width * 0.05)
					} else {
						Spacer(minLength: width * 0.05)
					}
					
					Spacer()
					
					nextButton
						.padding(.trailing, width * 0.05)
				}
				.padding(.vertical, 8)
			}
			.frame(height: 52)
		}
		.onAppear {
			loadDomainsIfNeeded()
			Analytics.logEvent("domain_selection_open", parameters: [
				"screen": "domain_selection" as NSString
			])
		}
	}
	
	// ─────────── Background ───────────
	private var backgroundLayer: some View {
		ZStack {
			if let asset = HomeImageSelector.selected {
				Image(asset)
					.resizable()
					.scaledToFill()
					.frame(maxWidth: .infinity, maxHeight: .infinity)
					.clipped()
					.ignoresSafeArea()
			} else {
				Color.black.ignoresSafeArea()
			}
			
			BlurView(style: .systemThinMaterial, intensity: 0.3)
				.ignoresSafeArea()
		}
	}
	
	// ─────────── Pills ───────────
	private func domainPill(for domain: Domain) -> some View {
		let isSelected = selectedDomainIds.contains(domain.id)
		
		return DomainPill(title: domain.name, isSelected: isSelected) {
			UIImpactFeedbackGenerator(style: .light).impactOccurred()
			withAnimation(.easeInOut(duration: 0.4)) {
				toggleDomain(domain)
			}
		}
	}
	
	private func domainHeaderPill(for domain: Domain) -> some View {
		Text(domain.name)
			.font(.system(size: 14, weight: .semibold))
			.lineLimit(1)
			.minimumScaleFactor(0.85)
			.padding(.horizontal, 12)
			.padding(.vertical, 8)
			.frame(minHeight: 32)
			.background(
				RoundedRectangle(cornerRadius: 18, style: .continuous)
					.fill(Color.white.opacity(0.10))
			)
			.overlay(
				RoundedRectangle(cornerRadius: 18, style: .continuous)
					.stroke(Color.accentPrimary, lineWidth: 1.5)
			)
			.shadow(color: Color.black.opacity(0.25), radius: 4, x: 0, y: 2)
			.foregroundColor(Color.accentPrimary)
	}
	
	private func categoryRow(for domain: Domain) -> some View {
		let domainId = domain.id
		let isExpanded = expandedDomainIds.contains(domainId)
		let categories = domain.categories
		let visibleCategories: [DomainCategory] = isExpanded ? categories : Array(categories.prefix(5))
		let hasMoreOrLess = categories.count > visibleCategories.count || isExpanded
		let allSelected = areAllCategoriesSelected(for: domain)
		
		return DomainPillFlowLayout(horizontalSpacing: 8, verticalSpacing: 8) {
			domainHeaderPill(for: domain)
			
			DomainPill(title: "All", isSelected: allSelected) {
				UIImpactFeedbackGenerator(style: .light).impactOccurred()
				withAnimation(.easeInOut(duration: 0.45)) {
					let wasExpanded = expandedDomainIds.contains(domainId)
					toggleAllCategories(for: domain)
					if !wasExpanded {
						expandedDomainIds.insert(domainId)
					}
				}
				
				Analytics.logEvent("domain_category_all_toggle", parameters: [
					"screen": "domain_selection" as NSString,
					"domain_id": domainId as NSString,
					"is_all_selected": NSNumber(value: areAllCategoriesSelected(for: domain))
				])
			}
			
			ForEach(visibleCategories, id: \.id) { category in
				let categoryId = category.id
				let isSelected = selectedCategoriesByDomain[domainId, default: []].contains(categoryId)
				
				DomainPill(title: category.name, isSelected: isSelected) {
					UIImpactFeedbackGenerator(style: .light).impactOccurred()
					withAnimation(.easeInOut(duration: 0.35)) {
						toggleCategory(domainId: domainId, categoryId: categoryId)
					}
				}
			}
			
			if hasMoreOrLess {
				let label = isExpanded ? "Less" : "More"
				
				Button {
					UIImpactFeedbackGenerator(style: .light).impactOccurred()
					
					withAnimation(.easeInOut(duration: 0.45)) {
						if isExpanded {
							expandedDomainIds.remove(domainId)
						} else {
							expandedDomainIds.insert(domainId)
						}
					}
					
					Analytics.logEvent("domain_category_more_toggle", parameters: [
						"screen": "domain_selection" as NSString,
						"domain_id": domainId as NSString,
						"is_expanded": NSNumber(value: expandedDomainIds.contains(domainId))
					])
				} label: {
					Text(label)
						.font(.system(size: 14, weight: .semibold))
						.lineLimit(1)
						.minimumScaleFactor(0.85)
						.padding(.horizontal, 12)
						.padding(.vertical, 8)
						.frame(minHeight: 32)
						.background(
							RoundedRectangle(cornerRadius: 18, style: .continuous)
								.fill(Color.white.opacity(0.10))
						)
						.overlay(
							RoundedRectangle(cornerRadius: 18, style: .continuous)
								.stroke(Color("AccentTertiary"), lineWidth: 1.5)
						)
						.shadow(color: Color.black.opacity(0.25), radius: 4, x: 0, y: 2)
						.foregroundColor(Color("AccentTertiary"))
				}
				.buttonStyle(.plain)
			}
		}
		.animation(.easeInOut(duration: 0.45), value: expandedDomainIds)
	}
	
	private func areAllCategoriesSelected(for domain: Domain) -> Bool {
		let allIds = Set(domain.categories.map { $0.id })
		let current = selectedCategoriesByDomain[domain.id, default: []]
		return !allIds.isEmpty && current.count == allIds.count
	}
	
	private func toggleAllCategories(for domain: Domain) {
		let domainId = domain.id
		let allSet = Set(domain.categories.map { $0.id })
		var current = selectedCategoriesByDomain[domainId] ?? []
		
		if current.count == allSet.count {
			current.removeAll()
		} else {
			current = allSet
		}
		selectedCategoriesByDomain[domainId] = current
	}
	
	// ─────────── Next / Back actions ───────────
	private var nextButton: some View {
		Button {
			handleNext()
		} label: {
			Image(systemName: "arrow.right.circle.fill")
				.font(.system(size: 32, weight: .semibold))
		}
		.buttonStyle(.plain)
		.foregroundColor(canAdvance ? Color.accentSecondary : Color.white.opacity(0.35))
		.disabled(!canAdvance)
	}
	
	private func handleNext() {
		switch step {
		case .domains:
			Analytics.logEvent("domain_selection_next_domains", parameters: [
				"screen": "domain_selection" as NSString,
				"selected_domain_count": NSNumber(value: selectedDomainIds.count)
			])
			
			guard hasDomainSelection else { return }
			
			transitionDirection = .forward
			withAnimation(.easeInOut(duration: 0.45)) {
				step = .categories
			}
			
		case .categories:
			persistPreferences()
			
			Analytics.logEvent("domain_selection_next_categories", parameters: [
				"screen": "domain_selection" as NSString,
				"selected_domain_count": NSNumber(value: selectedDomainIds.count),
				"selected_category_count": NSNumber(
					value: selectedCategoriesByDomain.values.reduce(0) { $0 + $1.count }
				)
			])
			
			onDone()
		}
	}
	
	private func toggleDomain(_ domain: Domain) {
		let id = domain.id
		if selectedDomainIds.contains(id) {
			selectedDomainIds.remove(id)
			selectedCategoriesByDomain.removeValue(forKey: id)
			expandedDomainIds.remove(id)
		} else {
			selectedDomainIds.insert(id)
			if selectedCategoriesByDomain[id] == nil {
				selectedCategoriesByDomain[id] = []
			}
		}
		
		Analytics.logEvent("domain_toggle", parameters: [
			"screen": "domain_selection" as NSString,
			"domain_id": id as NSString,
			"domain_name": domain.name as NSString,
			"is_selected": NSNumber(value: selectedDomainIds.contains(id))
		])
	}
	
	private func toggleCategory(domainId: String, categoryId: String) {
		guard selectedDomainIds.contains(domainId) else { return }
		
		var set = selectedCategoriesByDomain[domainId] ?? []
		if set.contains(categoryId) {
			set.remove(categoryId)
		} else {
			set.insert(categoryId)
		}
		selectedCategoriesByDomain[domainId] = set
		
		Analytics.logEvent("domain_category_toggle", parameters: [
			"screen": "domain_selection" as NSString,
			"domain_id": domainId as NSString,
			"category": categoryId as NSString,
			"is_selected": NSNumber(value: set.contains(categoryId))
		])
	}
	
	// ─────────── Data loading / persistence ───────────
	private func applyPreferences(_ prefs: [String: [String]]) {
		let validDomainsById: [String: Domain] = domains
			.filter { $0.display }
			.reduce(into: [:]) { result, domain in
				result[domain.id] = domain
			}
		
		var domainIds: Set<String> = []
		var catsByDomain: [String: Set<String>] = [:]
		
		for (domainId, categories) in prefs {
			guard let domain = validDomainsById[domainId] else { continue }
			
			let validCategoryIds = Set(domain.categories.map { $0.id })
			let filteredCategories = categories.filter { validCategoryIds.contains($0) }
			
			domainIds.insert(domainId)
			catsByDomain[domainId] = Set(filteredCategories)
		}
		
		selectedDomainIds = domainIds
		selectedCategoriesByDomain = catsByDomain
	}
	
	private func loadDomainsIfNeeded() {
		guard domains.isEmpty else {
			loadExistingPreferences()
			return
		}
		
		Firestore.firestore().collection("domains").getDocuments { snapshot, error in
			guard error == nil, let docs = snapshot?.documents else { return }
			
			let loaded: [Domain] = docs.compactMap { doc in
				let data = doc.data()
				guard let name = data["name"] as? String else { return nil }
				let display       = data["display"] as? Bool ?? true
				let categoryLabel = data["categoryLabel"] as? String ?? ""
				let imageUrl      = data["imageUrl"] as? String
				
				let rawCategories = data["categories"] as? [[String: Any]] ?? []
				let categories: [DomainCategory] = rawCategories.compactMap { cat in
					guard let id = cat["id"] as? String,
						  let name = cat["name"] as? String else { return nil }
					return DomainCategory(id: id, name: name)
				}
				
				return Domain(
					id: doc.documentID,
					name: name,
					display: display,
					categoryLabel: categoryLabel,
					categories: categories,
					imageUrl: imageUrl
				)
			}
			
			DispatchQueue.main.async {
				self.domains = loaded
				self.loadExistingPreferences()
			}
		}
	}
	
	private func loadExistingPreferences() {
		if let user = servicesLocator.userService.user,
		   !user.domainPreferences.isEmpty {
			DispatchQueue.main.async {
				self.applyPreferences(user.domainPreferences)
				RankingService.shared.updateDomainPreferences(user.domainPreferences)
			}
			return
		}
		
		guard let uid = Auth.auth().currentUser?.uid else { return }
		
		Firestore.firestore()
			.collection("users")
			.document(uid)
			.getDocument { snapshot, _ in
				guard
					let data = snapshot?.data(),
					let prefs = data["domainPreferences"] as? [String: [String]]
				else { return }
				
				DispatchQueue.main.async {
					self.applyPreferences(prefs)
					
					if var current = self.servicesLocator.userService.user {
						current.domainPreferences = prefs
						self.servicesLocator.userService.user = current
					}
					
					RankingService.shared.updateDomainPreferences(prefs)
				}
			}
	}
	
	private func persistPreferences() {
		guard let uid = Auth.auth().currentUser?.uid else { return }
		
		let visibleDomainIds = Set(displayDomains.map { $0.id })
		
		selectedDomainIds = selectedDomainIds.intersection(visibleDomainIds)
		selectedCategoriesByDomain = selectedCategoriesByDomain
			.filter { visibleDomainIds.contains($0.key) && selectedDomainIds.contains($0.key) }
		
		let prefsDict: [String: [String]] = selectedDomainIds.reduce(into: [:]) { dict, domainId in
			guard let domain = domains.first(where: { $0.id == domainId }) else { return }
			let validCategoryIds = Set(domain.categories.map { $0.id })
			let categoriesSet = selectedCategoriesByDomain[domainId] ?? []
			let filtered = categoriesSet.intersection(validCategoryIds)
			dict[domainId] = Array(filtered).sorted()
		}
		
		let hasLoadedUser = (servicesLocator.userService.user != nil)
		
		Analytics.logEvent("domain_preferences_save_start", parameters: [
			"screen": "domain_selection" as NSString,
			"trigger": "next_categories" as NSString,
			"domain_count": NSNumber(value: prefsDict.count),
			"uid_present": NSNumber(value: !uid.isEmpty),
			"has_loaded_user": NSNumber(value: hasLoadedUser)
		])
		
		servicesLocator.userService.updateDomainPreferences(prefsDict) { ok, errorMessage in
			Analytics.logEvent("domain_preferences_save_result", parameters: [
				"screen": "domain_selection" as NSString,
				"trigger": "next_categories" as NSString,
				"ok": NSNumber(value: ok),
				"domain_count": NSNumber(value: prefsDict.count),
				"error": (errorMessage ?? "") as NSString
			])
			
			if ok && !hasLoadedUser {
				self.servicesLocator.userService.refreshCurrentUser()
			}
		}
		
		RankingService.shared.updateDomainPreferences(prefsDict)
		homeViewModel.reloadHomeAfterDomainPreferencesChange(prefsDict)
		
		Analytics.logEvent("domain_preferences_updated", parameters: [
			"screen": "domain_selection" as NSString,
			"domain_count": NSNumber(value: selectedDomainIds.count),
			"category_count": NSNumber(value: selectedCategoriesByDomain.values.reduce(0) { $0 + $1.count }),
			"step": "categories" as NSString
		])
	}
}

// ─────────── Flow layout for pills ───────────
struct DomainPillFlowLayout: Layout {
	var horizontalSpacing: CGFloat
	var verticalSpacing: CGFloat
	
	func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
		let maxWidth = proposal.width ?? UIScreen.main.bounds.width * 0.8
		guard maxWidth > 0 else { return .zero }
		
		var x: CGFloat = 0
		var y: CGFloat = 0
		var rowHeight: CGFloat = 0
		
		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			
			if x + size.width > maxWidth, x > 0 {
				x = 0
				y += rowHeight + verticalSpacing
				rowHeight = 0
			}
			
			rowHeight = max(rowHeight, size.height)
			x += size.width + horizontalSpacing
		}
		
		y += rowHeight
		return CGSize(width: maxWidth, height: y)
	}
	
	func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
		let maxWidth = bounds.width
		var x = bounds.minX
		var y = bounds.minY
		var rowHeight: CGFloat = 0
		
		for subview in subviews {
			let size = subview.sizeThatFits(.unspecified)
			
			if x + size.width > bounds.minX + maxWidth, x > bounds.minX {
				x = bounds.minX
				y += rowHeight + verticalSpacing
				rowHeight = 0
			}
			
			subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
			rowHeight = max(rowHeight, size.height)
			x += size.width + horizontalSpacing
		}
	}
}
