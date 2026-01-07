import Foundation
import FirebaseAuth

// MARK: - Agent Respond models

public struct AgentRespondRequest: Encodable {
	public let input_as_text: String
	public let user_id: String?
	public let geo_city: String?
	public let card: AgentCardBrief?
	public let today_iso: String?
	public let model_cutoff_iso: String?
	public let recency_buffer_days: Int?
	
	public init(
		input_as_text: String,
		user_id: String? = nil,
		geo_city: String? = nil,
		card: AgentCardBrief? = nil,
		today_iso: String? = nil,
		model_cutoff_iso: String? = nil,
		recency_buffer_days: Int? = nil
	) {
		self.input_as_text = input_as_text
		self.user_id = user_id
		self.geo_city = geo_city
		self.card = card
		self.today_iso = today_iso
		self.model_cutoff_iso = model_cutoff_iso
		self.recency_buffer_days = recency_buffer_days
	}
}

public struct AgentCardBrief: Encodable {
	public let id: String?
	public let headline: String?
	public let body: String?
	public let topic: String?
	
	public init(id: String?, headline: String?, body: String?, topic: String?) {
		self.id = id
		self.headline = headline
		self.body = body
		self.topic = topic
	}
}

public struct AgentWidget: Decodable {
	public let type: String
	public let canonical_id: String?
	public let title: String?
	public let subtitle: String?
	public let artwork_url: String?
	public let preview_url: String?
	public let poster_url: String?
	public let trailer_url: String?
	public let address: String?
	public let photo_url: String?
	public let ticker: String?
	public let cover_url: String?
	public let confidence: Double?
	public let reasons: [String]?
	
	// Optional company/stock extras + time series (if server includes)
	public let companyName: String?
	public let companyLogoURL: String?
	public let companyIndustry: String?
	public let companyURL: String?
	public let dataPoints: [StockPoint]?
	
	public struct StockPoint: Decodable {
		public let date: String
		public let close: Double
	}
	
	enum CodingKeys: String, CodingKey {
		case type, canonical_id, title, subtitle, artwork_url, preview_url, poster_url, trailer_url,
			 address, photo_url, ticker, cover_url, confidence, reasons
		case companyName, companyLogoURL, companyIndustry, companyURL, dataPoints
		case company_name, company_logo_url, company_industry, company_url, data_points
	}
	
	public init(from decoder: Decoder) throws {
		let c = try decoder.container(keyedBy: CodingKeys.self)
		type         = try c.decode(String.self,  forKey: .type)
		canonical_id = try c.decodeIfPresent(String.self, forKey: .canonical_id)
		title        = try c.decodeIfPresent(String.self, forKey: .title)
		subtitle     = try c.decodeIfPresent(String.self, forKey: .subtitle)
		artwork_url  = try c.decodeIfPresent(String.self, forKey: .artwork_url)
		preview_url  = try c.decodeIfPresent(String.self, forKey: .preview_url)
		poster_url   = try c.decodeIfPresent(String.self, forKey: .poster_url)
		trailer_url  = try c.decodeIfPresent(String.self, forKey: .trailer_url)
		address      = try c.decodeIfPresent(String.self, forKey: .address)
		photo_url    = try c.decodeIfPresent(String.self, forKey: .photo_url)
		ticker       = try c.decodeIfPresent(String.self, forKey: .ticker)
		cover_url    = try c.decodeIfPresent(String.self, forKey: .cover_url)
		confidence   = try c.decodeIfPresent(Double.self, forKey: .confidence)
		reasons      = try c.decodeIfPresent([String].self, forKey: .reasons)
		
		// tolerant decode for stock/company extras
		companyName     = try c.decodeIfPresent(String.self, forKey: .companyName)
		?? c.decodeIfPresent(String.self, forKey: .company_name)
		companyLogoURL  = try c.decodeIfPresent(String.self, forKey: .companyLogoURL)
		?? c.decodeIfPresent(String.self, forKey: .company_logo_url)
		companyIndustry = try c.decodeIfPresent(String.self, forKey: .companyIndustry)
		?? c.decodeIfPresent(String.self, forKey: .company_industry)
		companyURL      = try c.decodeIfPresent(String.self, forKey: .companyURL)
		?? c.decodeIfPresent(String.self, forKey: .company_url)
		dataPoints      = try c.decodeIfPresent([StockPoint].self, forKey: .dataPoints)
		?? c.decodeIfPresent([StockPoint].self, forKey: .data_points)
	}
}

public struct AgentRespondResponse: Decodable {
	public let text: String?
	public let widgets: [AgentWidget]?
}

// MARK: - API

enum CuratorAPI {
	static var baseURL = URL(string: "https://us-central1-ponder-f84ce.cloudfunctions.net")!
	
	/// New Curator Agent endpoint (replaces curator_plan_and_execute)
	static func agentRespond(
		userText: String,
		geoCity: String? = nil,
		initialCard: Card? = nil,
		modelCutoffISO: String? = CuratorConfig.modelCutoffISO,
		recencyBufferDays: Int? = CuratorConfig.recencyBufferDays,
		session: URLSession = .shared
	) async throws -> AgentRespondResponse {
		let iso = ISO8601DateFormatter()
		let todayISO = iso.string(from: Date())
		
		let uid = Auth.auth().currentUser?.uid
		let cardBrief = AgentCardBrief(
			id: initialCard?.id,
			headline: initialCard?.headline,
			body: initialCard?.body,
			topic: initialCard?.topic
		)
		
		let reqModel = AgentRespondRequest(
			input_as_text: userText,
			user_id: uid,
			geo_city: geoCity,
			card: cardBrief,
			today_iso: todayISO,
			model_cutoff_iso: modelCutoffISO,
			recency_buffer_days: recencyBufferDays
		)
		
		let url = baseURL.appendingPathComponent("agent_respond")
		var req = URLRequest(url: url)
		req.httpMethod = "POST"
		req.setValue("application/json", forHTTPHeaderField: "Content-Type")
		req.timeoutInterval = 30
		req.httpBody = try JSONEncoder().encode(reqModel)
		
		if let idToken = try? await currentIDToken() {
			req.setValue("Bearer \(idToken)", forHTTPHeaderField: "Authorization")
		}
		
		let (data, resp) = try await session.data(for: req)
		guard let http = resp as? HTTPURLResponse else {
			throw NSError(domain: "CuratorAPI", code: -1, userInfo: [NSLocalizedDescriptionKey: "No HTTP response"])
		}
		guard (200...299).contains(http.statusCode) else {
			let body = String(data: data, encoding: .utf8) ?? ""
			throw NSError(domain: "CuratorAPI", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "Server error \(http.statusCode): \(body)"])
		}
		
		return try JSONDecoder().decode(AgentRespondResponse.self, from: data)
	}
	
	private static func currentIDToken() async throws -> String? {
		guard let user = Auth.auth().currentUser else { return nil }
		return try await withCheckedThrowingContinuation { cont in
			user.getIDTokenForcingRefresh(false) { token, err in
				if let err { cont.resume(throwing: err) }
				else { cont.resume(returning: token) }
			}
		}
	}
}
