import Foundation

// ─────────── Model ───────────
struct PersonMetadata: Codable, Equatable {
    struct Attribution: Codable, Equatable {
        let credit: String?
        let license: String?
        let sourceURL: String?
        
        init(credit: String? = nil, license: String? = nil, sourceURL: String? = nil) {
            self.credit   = credit
            self.license  = license
            self.sourceURL = sourceURL
        }
    }
    
    let name: String?
    let role: String?
    let imageURL: String?
    let wikipediaURL: URL?
    let officialURL: String?
    let wikidataID: String?
    let imageAttribution: Attribution?
    
    init(
        name: String? = nil,
        role: String? = nil,
        imageURL: String? = nil,
        wikipediaURL: URL? = nil,
        officialURL: String? = nil,
        wikidataID: String? = nil,
        imageAttribution: Attribution? = nil
    ) {
        self.name             = name
        self.role             = role
        self.imageURL         = imageURL
        self.wikipediaURL     = wikipediaURL
        self.officialURL      = officialURL
        self.wikidataID       = wikidataID
        self.imageAttribution = imageAttribution
    }
    
    init(fromJson json: [String: Any]) {
        self.name     = json["name"] as? String
        self.role     = json["role"] as? String
        self.imageURL = json["imageURL"] as? String
        
        if let wikiStr = json["wikipediaURL"] as? String {
            self.wikipediaURL = URL(string: wikiStr)
        } else {
            self.wikipediaURL = nil
        }
        
        self.officialURL = json["officialURL"] as? String
        self.wikidataID  = json["wikidataID"] as? String
        
        if let attr = json["imageAttribution"] as? [String: Any] {
            let credit  = attr["credit"] as? String
            let license = attr["license"] as? String
            let source  = attr["sourceURL"] as? String
            self.imageAttribution = Attribution(credit: credit, license: license, sourceURL: source)
        } else {
            self.imageAttribution = nil
        }
    }
}
