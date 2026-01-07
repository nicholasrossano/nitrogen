import Foundation
import FirebaseAuth
import FirebaseFirestore

struct RankProfile: Codable {
	let domainWeights: [String: Double]
	let categoryWeights: [String: Double]
	let entityWeights: [String: Double]
	let lastUpdated: Date?
}

struct RankingConfig: Codable {
	struct Weights: Codable {
		let base: Double
		let entity: Double
		let domain: Double
		let category: Double
		let recency: Double
		
		private enum CodingKeys: String, CodingKey {
			case base
			case entity
			case domain
			case category
			case recency
			case topic
			case source
		}
		
		init(base: Double, entity: Double, domain: Double, category: Double, recency: Double) {
			self.base = base
			self.entity = entity
			self.domain = domain
			self.category = category
			self.recency = recency
		}
		
		init(from decoder: Decoder) throws {
			let container = try decoder.container(keyedBy: CodingKeys.self)
			let base = try container.decodeIfPresent(Double.self, forKey: .base) ?? 0.45
			let entity = try container.decodeIfPresent(Double.self, forKey: .entity) ?? 0.30
			let domain = try container.decodeIfPresent(Double.self, forKey: .domain)
			?? container.decodeIfPresent(Double.self, forKey: .topic)
			?? 0.20
			let category = try container.decodeIfPresent(Double.self, forKey: .category)
			?? container.decodeIfPresent(Double.self, forKey: .source)
			?? 0.20
			let recency = try container.decodeIfPresent(Double.self, forKey: .recency) ?? 0.15
			self.init(base: base, entity: entity, domain: domain, category: category, recency: recency)
		}
		
		func encode(to encoder: Encoder) throws {
			var container = encoder.container(keyedBy: CodingKeys.self)
			try container.encode(base, forKey: .base)
			try container.encode(entity, forKey: .entity)
			try container.encode(domain, forKey: .domain)
			try container.encode(category, forKey: .category)
			try container.encode(recency, forKey: .recency)
		}
	}
	
	struct Penalties: Codable {
		let seen: Double
		let dup: Double
	}
	struct HalfLives: Codable {
		let readsDays: Double
		let recencyHours: Double
	}
	struct Caps: Codable {
		let dwellMs: Int64
	}
	let weights: Weights
	let penalties: Penalties
	let halfLives: HalfLives
	let caps: Caps
	let explorationEpsilon: Double
	let scoreFloor: Double?
	let floorGraceHours: Double?
	let neighborSimWeight: Double?
}

final class RankingService: ObservableObject {
	static let shared = RankingService()
	
	private let db = Firestore.firestore()
	private var profile: RankProfile?
	private var cfg: RankingConfig = RankingService.defaults
	private var didDumpProfile = false
	
	private var domainPreferences: [String: [String]] = [:]
	private var dislikedCardIds: Set<String> = []
	
	private let diversityWindowTopN: Int = 10
	private let diversityNudgeSlots: Int = 3
	private let noveltyInsertIndex: Int = 4
	
	static var defaults: RankingConfig {
		RankingConfig(
			weights: .init(
				base: 0.45,
				entity: 0.30,
				domain: 0.20,
				category: 0.20,
				recency: 0.15
			),
			penalties: .init(seen: 0.25, dup: 0.15),
			halfLives: .init(
				readsDays: 7.0,
				recencyHours: 48.0
			),
			caps: .init(dwellMs: 60000),
			explorationEpsilon: 0.10,
			scoreFloor: 0.1,
			floorGraceHours: nil,
			neighborSimWeight: 0.25
		)
	}
	
	// ─────────── Public: domain prefs injection ───────────
	func updateDomainPreferences(_ prefs: [String: [String]]) {
		DispatchQueue.main.async {
			self.domainPreferences = prefs
		}
	}
	
	// ─────────── Config/Profile Refresh ───────────
	func refreshProfile() {
		guard let uid = Auth.auth().currentUser?.uid else {
			DispatchQueue.main.async {
				self.profile = nil
				self.domainPreferences = [:]
				self.dislikedCardIds = []
			}
			return
		}
		
		db.collection("config").document("ranking").getDocument { snap, _ in
			DispatchQueue.main.async {
				let prev = self.cfg
				if let d = snap?.data(),
				   let json = try? JSONSerialization.data(withJSONObject: d),
				   let rc = try? JSONDecoder().decode(RankingConfig.self, from: json) {
					
					let merged = RankingConfig(
						weights: rc.weights,
						penalties: rc.penalties,
						halfLives: rc.halfLives,
						caps: rc.caps,
						explorationEpsilon: rc.explorationEpsilon,
						scoreFloor: rc.scoreFloor ?? prev.scoreFloor,
						floorGraceHours: rc.floorGraceHours ?? prev.floorGraceHours,
						neighborSimWeight: rc.neighborSimWeight ?? prev.neighborSimWeight
					)
					self.cfg = merged
#if DEBUG
					print("[Ranking] config floor=\(merged.scoreFloor.map { self.fmt($0) } ?? "-") (merged)")
#endif
				} else {
#if DEBUG
					print("[Ranking] config floor=\(prev.scoreFloor.map { self.fmt($0) } ?? "-") (defaults)")
#endif
				}
			}
		}
		
		db.collection("users").document(uid).collection("rankProfile").document("latest").getDocument { snap, _ in
			DispatchQueue.main.async {
				if let d = snap?.data() {
					let domainWeights = (d["domainWeights"] as? [String: Double])
					?? (d["topicWeights"] as? [String: Double])
					?? [:]
					let categoryWeights = (d["categoryWeights"] as? [String: Double])
					?? (d["sourceWeights"] as? [String: Double])
					?? [:]
					let entityWeights = d["entityWeights"] as? [String: Double] ?? [:]
					let ts = (d["lastUpdated"] as? Timestamp)?.dateValue()
					
					self.profile = RankProfile(
						domainWeights: domainWeights,
						categoryWeights: categoryWeights,
						entityWeights: entityWeights,
						lastUpdated: ts
					)
				} else {
					self.profile = nil
				}
			}
		}
		
		db.collection("users").document(uid).getDocument { snap, _ in
			DispatchQueue.main.async {
				guard let data = snap?.data() else {
					self.domainPreferences = [:]
					return
				}
				if let rawPrefs = data["domainPreferences"] as? [String: Any] {
					var converted: [String: [String]] = [:]
					for (key, value) in rawPrefs {
						if let arr = value as? [String] {
							converted[key] = arr
						}
					}
					self.domainPreferences = converted
				} else {
					self.domainPreferences = [:]
				}
			}
		}
		
		db.collection("users").document(uid).collection("cardDislikes").getDocuments { snap, _ in
			DispatchQueue.main.async {
				let ids = snap?.documents.map { $0.documentID } ?? []
				self.dislikedCardIds = Set(ids)
			}
		}
	}
	
	// ─────────── Rank entrypoints ───────────
	func rank(cards: [Card], topicName: String) -> [Card] {
		return rank(cards: cards, topicName: topicName, neighborSims: [:])
	}
	
	func rank(cards: [Card], topicName: String, neighborSims: [String: Double]) -> [Card] {
		let cfg = self.cfg
		let prof = self.profile
		let now = Date()
		let H = cfg.halfLives.recencyHours
		let wNS = cfg.neighborSimWeight ?? 0.0
		
#if DEBUG
		if !didDumpProfile {
			didDumpProfile = true
			debugPrintProfileTopK()
		}
#endif
		
		guard !cards.isEmpty else {
#if DEBUG
			print("[Ranking] topic=\(topicName) total=0 kept=0 filtered=0 filtered_pct=0.0% floor=\(cfg.scoreFloor.map { fmt($0) } ?? "-") kept_due_to_no_profile=0 dist[min=0.000 p05=0.000 p10=0.000 median=0.000 max=0.000]")
#endif
			return cards
		}
		
		let inputCards = cards.filter { !dislikedCardIds.contains($0.id) }
		let cardsToRank = inputCards.isEmpty ? cards : inputCards
		
		let raw: [(Card, Double, Double)] = cardsToRank.map { c in
			let base = normalizeBaseScore(c.rankingScore)
			let recency = recencyScore(for: c.timestamp, now: now, halfLifeHours: H)
			let domainW = domainWeight(for: c, profile: prof)
			let entityW = entityWeight(for: c, profile: prof)
			let categoryW = categoryWeight(for: c, profile: prof)
			let nSim = max(0.0, min(1.0, neighborSims[c.id] ?? 0.0))
			let score = cfg.weights.base * base
			+ cfg.weights.domain * domainW
			+ cfg.weights.entity * entityW
			+ cfg.weights.category * categoryW
			+ cfg.weights.recency * recency
			+ wNS * nSim
			return (c, score, recency)
		}
		
		var sorted = raw.sorted { $0.1 > $1.1 }
		let scoresOnly = sorted.map { $0.1 }
		let dist = basicQuantiles(scoresOnly)
		
		var kept: [(Card, Double)] = []
		var filteredReasons: [String] = []
		var keptDueToNoProfile = 0
		let graceH = cfg.floorGraceHours ?? 0.0
		
		if let floor = cfg.scoreFloor {
			for (card, score, _) in sorted {
				let allowFresh: Bool = {
					guard graceH > 0, let ts = card.timestamp else { return false }
					let ageH = now.timeIntervalSince(ts) / 3600.0
					return ageH <= graceH
				}()
				if score >= floor || allowFresh {
					kept.append((card, score))
				} else if prof == nil {
					kept.append((card, score))
					keptDueToNoProfile += 1
				} else {
					let domainId = card.domainId ?? "-"
					filteredReasons.append("filtered \(cardIdentifier(card)) score=\(fmt(score)) < floor=\(fmt(floor)), domain_id=\(domainId)")
				}
			}
		} else {
			kept = sorted.map { ($0.0, $0.1) }
		}
		
		if kept.isEmpty { return sorted.map { $0.0 } }
		
		var adjusted = kept
		
		adjusted = nudgeByPreferredCategories(adjusted)
		
		let diversified = diversifyByEntity(adjusted, windowTopN: diversityWindowTopN, nudgeSlots: diversityNudgeSlots)
		let finalWithExplore = maybeInjectExploration(diversified, profile: prof, epsilon: cfg.explorationEpsilon)
		
#if DEBUG
		let total = max(1, sorted.count)
		let keptCount = finalWithExplore.count
		let filteredCount = total - keptCount
		let filteredPct = Double(filteredCount) / Double(total)
		let floorStr = cfg.scoreFloor.map { fmt($0) } ?? "-"
		print("[Ranking] topic=\(topicName) total=\(total) kept=\(keptCount) filtered=\(filteredCount) filtered_pct=\(fmtPct(filteredPct)) floor=\(floorStr) kept_due_to_no_profile=\(keptDueToNoProfile) dist[min=\(fmt(dist.min)) p05=\(fmt(dist.p05)) p10=\(fmt(dist.p10)) median=\(fmt(dist.median)) max=\(fmt(dist.max))]")
		if filteredCount > 0 {
			for line in filteredReasons.prefix(10) { print("[Ranking] \(line)") }
			if filteredCount > 10 { print("[Ranking] …and \(filteredCount - 10) more filtered") }
		}
#endif
		
		return finalWithExplore.map { $0.0 }
	}
	
	// ─────────── Category nudge based on domain prefs (no gating) ───────────
	private func nudgeByPreferredCategories(_ arr: [(Card, Double)]) -> [(Card, Double)] {
		guard !domainPreferences.isEmpty else { return arr }
		var preferred: [(Card, Double)] = []
		var others: [(Card, Double)] = []
		
		for pair in arr {
			let (card, score) = pair
			guard let domId = card.domainId,
				  let prefs = domainPreferences[domId], !prefs.isEmpty else {
				others.append(pair)
				continue
			}
			let catIds = Set(card.domainCategories)
			if !catIds.isEmpty && !Set(prefs).isDisjoint(with: catIds) {
				preferred.append((card, score))
			} else {
				others.append(pair)
			}
		}
		return preferred + others
	}
	
	// ─────────── Scoring Pieces ───────────
	private func normalizeBaseScore(_ val: Double?) -> Double {
		guard let v = val else { return 0.5 }
		if v <= 1.0 { return max(0.0, min(1.0, v)) }
		if v <= 100.0 { return max(0.0, min(1.0, v/100.0)) }
		return 0.8
	}
	
	private func recencyScore(for ts: Date?, now: Date, halfLifeHours: Double) -> Double {
		guard let t = ts else { return 0.6 }
		let ageH = now.timeIntervalSince(t)/3600.0
		if ageH < 0 { return 1.0 }
		let lambda = log(2.0)/halfLifeHours
		return exp(-lambda*ageH)
	}
	
	private func clampSigned(_ x: Double) -> Double {
		return max(-1.0, min(1.0, x))
	}
	
	private func domainWeight(for card: Card, profile: RankProfile?) -> Double {
		guard let prof = profile else { return 0.0 }
		guard let domId = card.domainId else { return 0.0 }
		return clampSigned(prof.domainWeights[domId] ?? 0.0)
	}
	
	private func categoryWeight(for card: Card, profile: RankProfile?) -> Double {
		guard let prof = profile else { return 0.0 }
		let cats = card.domainCategories
		guard !cats.isEmpty else { return 0.0 }
		
		var best = 0.0
		for c in cats {
			if let v = prof.categoryWeights[c] {
				if abs(v) > abs(best) { best = v }
			}
		}
		
		if let domId = card.domainId, let prefs = domainPreferences[domId], !prefs.isEmpty {
			let preferred = Set(prefs)
			if !preferred.isDisjoint(with: Set(cats)) {
				best = max(best, 1.0)
			}
		}
		return clampSigned(best)
	}
	
	private func entityWeight(for card: Card, profile: RankProfile?) -> Double {
		guard let prof = profile else { return 0.0 }
		guard let em = card.enrichedMetadata, let ce = em.coreEntity else { return 0.0 }
		let keys = FacetExtractor.facetKeys(from: ce)
		var best = 0.0
		for k in keys {
			if let v = prof.entityWeights[k] {
				if abs(v) > abs(best) { best = v }
			}
		}
		return clampSigned(best)
	}
	
	// ─────────── Diversity / Exploration helpers ───────────
	private func entityKey(for card: Card) -> String? {
		guard let em = card.enrichedMetadata, let ce = em.coreEntity else { return nil }
		let keys = FacetExtractor.facetKeys(from: ce)
		return keys.first(where: { $0.hasPrefix("entity:") })
	}
	
	private func diversifyByEntity(_ arr: [(Card, Double)],
								   windowTopN: Int,
								   nudgeSlots: Int) -> [(Card, Double)] {
		guard arr.count > 2, windowTopN > 2, nudgeSlots > 0 else { return arr }
		var out = arr
		var seen: Set<String> = []
		let limit = min(windowTopN, out.count)
		var i = 0
		while i < limit {
			let (c, s) = out[i]
			if let ek = entityKey(for: c) {
				if seen.contains(ek) {
					let target = min(out.count - 1, i + nudgeSlots)
					if target > i {
						out.remove(at: i)
						out.insert((c, s), at: target)
						i += 1
						continue
					}
				} else {
					seen.insert(ek)
				}
			}
			i += 1
		}
		return out
	}
	
	private func maybeInjectExploration(_ arr: [(Card, Double)],
										profile: RankProfile?,
										epsilon: Double) -> [(Card, Double)] {
		guard !arr.isEmpty, epsilon > 0 else { return arr }
		if Double.random(in: 0.0...1.0) >= epsilon { return arr }
		let prof = profile
		
		let tail = arr.dropFirst(min(arr.count, diversityWindowTopN))
		var pickIndex: Int?
		if let prof = prof {
			for (idx, item) in tail.enumerated() {
				let (card, _) = item
				let eW = entityWeight(for: card, profile: prof)
				let cW = categoryWeight(for: card, profile: prof)
				if eW <= 0.0 && cW <= 0.0 {
					pickIndex = idx + min(arr.count, diversityWindowTopN)
					break
				}
			}
		}
		guard let idx = pickIndex else { return arr }
		
		var out = arr
		let insertAt = min(max(0, noveltyInsertIndex), out.count - 1)
		let picked = out.remove(at: idx)
		out.insert(picked, at: insertAt)
		return out
	}
	
	// ─────────── Debug ───────────
	private func debugPrintProfileTopK(k: Int = 8) {
		guard let p = profile else {
			print("[Ranking] profile=nil (no personalized weights yet)")
			return
		}
		func top(_ d: [String: Double]) -> String {
			guard !d.isEmpty else { return "-" }
			return d.sorted { abs($0.value) > abs($1.value) }
				.prefix(k)
				.map { "\($0.key)=\(fmt($0.value))" }
				.joined(separator: ", ")
		}
		print("[Ranking] top_domains: \(top(p.domainWeights))")
		print("[Ranking] top_categories: \(top(p.categoryWeights))")
		print("[Ranking] top_entities: \(top(p.entityWeights))")
	}
	
	private func cardIdentifier(_ card: Card) -> String {
		let m = Mirror(reflecting: card)
		for child in m.children {
			if let label = child.label?.lowercased(),
			   (label == "id" || label == "cardid" || label == "documentid" || label == "document_id"),
			   let v = child.value as? CustomStringConvertible {
				return String(describing: v)
			}
		}
		return "card"
	}
	
	private func fmt(_ x: Double) -> String { String(format: "%.3f", x) }
	private func fmtPct(_ x: Double) -> String { String(format: "%.1f%%", x * 100.0) }
	
	private func basicQuantiles(_ a: [Double]) -> (min: Double, p05: Double, p10: Double, median: Double, max: Double) {
		guard !a.isEmpty else { return (0,0,0,0,0) }
		let s = a.sorted()
		func q(_ p: Double) -> Double {
			let i = max(0, min(s.count - 1, Int(round(p * Double(s.count - 1)))))
			return s[i]
		}
		return (s.first!, q(0.05), q(0.10), q(0.50), s.last!)
	}
}
