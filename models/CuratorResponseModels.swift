import Foundation

struct CuratorActionData: Codable {
    let musicMetadata     : MusicMetadata?
    let filmTvMetadata    : FilmTvMetadata?
    let bookMetadata      : BookMetadata?
    let stockMetadata     : StockMetadata?
    let politicianMetadata: PoliticianMetadata?
    let athleteMetadata   : AthleteMetadata?
    let teamMetadata      : TeamMetadata?
}

struct CuratorAction: Codable {
    let actionId : String
    let directive: String
    let status   : String         // "ok" | "no_results" | "error"
    let data     : CuratorActionData?
    let error    : CuratorError?
    let sources  : [String]?
}

struct CuratorError: Codable {
    let code   : String?
    let message: String?
}

struct PlanExecuteResponse: Codable {
    let messageId    : String
    let assistantText: String?
    let actions      : [CuratorAction]
    let latencyMs    : Int
}
