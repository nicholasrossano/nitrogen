import SwiftUI
import Combine
import FirebaseFirestore
import FirebaseAnalytics

private struct ReportFormHeightKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
private struct ReportFooterHeightKey: PreferenceKey {
	static var defaultValue: CGFloat = 0
	static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct ReportMenu: View {
	@Binding var isPresented: Bool
	let cardId: String
	var onHeightChange: ((CGFloat) -> Void)? = nil
	
	@State private var selectedReason: String?
	@State private var comment: String = ""
	
	private let reasons: [(id: String, title: String)] = [
		(id: "dislike_content", title: "I want to see less content like this"),
		(id: "inappropriate_or_harmful", title: "Content is inappropriate or harmful"),
		(id: "inaccurate_or_low_quality", title: "Content is inaccurate or low quality"),
		(id: "topic_misclassification", title: "Card is not relevant to this topic"),
		(id: "irrelevant_cluster", title: "Irrelevant sources are grouped together"),
		(id: "widget_irrelevant", title: "Widget is irrelevant or low quality"),
		(id: "other", title: "Other")
	]
	
	@EnvironmentObject var servicesLocator: AppServicesLocator
	@State private var cancellables = Set<AnyCancellable>()
	
	// ─────────── Admin-only metadata state ───────────
	@State private var topicName: String?
	@State private var topicIdInternal: String?
	@State private var coreEntityType: String?
	@State private var isAdmin: Bool = false
	
	// ─────────── Dynamic sizing state ───────────
	@State private var formHeight: CGFloat = 0
	@State private var footerHeight: CGFloat = 0
	
	var body: some View {
		VStack(spacing: 0) {
			ScrollView {
				VStack(alignment: .leading, spacing: 16) {
					Text("What went wrong?")
						.font(.headline)
						.frame(maxWidth: .infinity, alignment: .center)
					
					VStack(alignment: .leading, spacing: 12) {
						ForEach(reasons, id: \.id) { reason in
							if reason.id == "other" {
								HStack(alignment: .firstTextBaseline, spacing: 6) {
									RadioButton(
										title: "Other",
										isSelected: selectedReason == reason.id
									)
									if isAdmin, let meta = metadataPairText() {
										Text(" | ")
											.foregroundColor(.secondary)
										Text("Metadata: \(meta)")
											.italic()
											.foregroundColor(.secondary)
									}
								}
								.contentShape(Rectangle())
								.onTapGesture {
									selectedReason = reason.id
									Analytics.logEvent(
										"report_reason_tap",
										parameters: [
											"screen": "report_menu" as NSString,
											"card_id": cardId as NSString,
											"reason_id": reason.id as NSString
										]
									)
								}
							} else {
								RadioButton(title: reason.title, isSelected: selectedReason == reason.id)
									.onTapGesture {
										selectedReason = reason.id
										Analytics.logEvent(
											"report_reason_tap",
											parameters: [
												"screen": "report_menu" as NSString,
												"card_id": cardId as NSString,
												"reason_id": reason.id as NSString
											]
										)
									}
							}
						}
					}
					
					TextField("Add a comment", text: $comment)
						.padding()
						.background(Color(.systemGray6))
						.cornerRadius(25)
				}
				.padding(.horizontal)
				.padding(.top, 24)
				.padding(.bottom, footerHeight + 24)
				.background(
					GeometryReader { proxy in
						Color.clear
							.preference(key: ReportFormHeightKey.self, value: proxy.size.height)
					}
				)
			}
			.environment(\.sizeCategory, .medium)
			.onAppear {
				isAdmin = (FeatureFlagsManager.shared.currentUserRole == "admin")
				loadMetadata()
				Analytics.logEvent(
					"report_menu_view",
					parameters: [
						"screen": "report_menu" as NSString,
						"card_id": cardId as NSString
					]
				)
			}
			
			HStack {
				Spacer()
				Button("Submit") {
					Analytics.logEvent(
						"report_submit_tap",
						parameters: [
							"screen": "report_menu" as NSString,
							"card_id": cardId as NSString,
							"topic_id": (topicIdInternal ?? "") as NSString,
							"reason_id": (selectedReason ?? "") as NSString
						]
					)
					submitReport()
					isPresented = false
				}
				.font(.custom("Avenir", size: 16))
				.foregroundColor(.white)
				.frame(width: 120, height: 44)
				.background(Color.accentPrimary)
				.cornerRadius(22)
				Spacer()
			}
			.padding(.vertical, 12)
			.padding(.horizontal, 24)
			.background(
				GeometryReader { proxy in
					Color.clear
						.preference(key: ReportFooterHeightKey.self, value: proxy.size.height)
				}
			)
		}
		.onPreferenceChange(ReportFormHeightKey.self) { h in
			formHeight = h
			notifyHeight()
		}
		.onPreferenceChange(ReportFooterHeightKey.self) { h in
			footerHeight = h
			notifyHeight()
		}
		.ignoresSafeArea(.container, edges: .bottom)
		.asNativeSheet()
	}
	
	// ─────────── Section Header ───────────
	private func notifyHeight() {
		let screenH = UIScreen.main.bounds.height
		let desired = formHeight + footerHeight + 24
		let fraction = max(0.30, min(0.82, desired / max(1, screenH)))
		onHeightChange?(fraction)
	}
	
	// ─────────── Submit to backend ───────────
	private func submitReport() {
		guard let reasonId = selectedReason else { return }
		guard let userId = servicesLocator.userService.getUserId() else { return }
		
		servicesLocator.reportService.submitReport(
			cardId: cardId,
			reasonId: reasonId,
			comment: comment
		)
		.sink(receiveCompletion: { _ in }, receiveValue: {})
		.store(in: &cancellables)
	}
	
	// ─────────── Metadata loading ───────────
	private func loadMetadata() {
		let db = Firestore.firestore()
		
		db.collection("cards").document(cardId).getDocument { doc, _ in
			guard let data = doc?.data() else { return }
			
			let topicId = data["topic"] as? String
			self.topicIdInternal = topicId
			
			if let enriched = data["enrichedMetadata"] as? [String: Any],
			   let core = enriched["coreEntity"] as? [String: Any],
			   let type = core["type"] as? String {
				self.coreEntityType = type
			}
			
			guard let topicId = topicId, !topicId.isEmpty else { return }
			
			db.collection("topics").document(topicId).getDocument { topicDoc, _ in
				let td = topicDoc?.data() ?? [:]
				let name = (td["name"] as? String) ?? (td["topic"] as? String)
				if let n = name, !n.isEmpty {
					self.topicName = n
				}
			}
		}
	}
	
	// ─────────── Inline label helpers ───────────
	private func metadataPairText() -> String? {
		let topicPart = topicName ?? topicIdInternal
		let typePart = coreEntityType
		if topicPart == nil && typePart == nil { return nil }
		
		switch (topicPart, typePart) {
		case let (t?, ty?):
			return "\(t) • \(ty)"
		case let (t?, nil):
			return "\(t)"
		case let (nil, ty?):
			return "\(ty)"
		default:
			return nil
		}
	}
}
