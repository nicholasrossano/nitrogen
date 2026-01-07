import Foundation

extension AthleteMetadata {
    func toCuratorAthlete() -> CuratorAthlete {
        CuratorAthlete(
            name: name,
            position: position,
            team: team,
            league: league,
            imageURL: imageURL.flatMap(URL.init),
            externalURL: (espnURL ?? wikipediaURL),
            ranking: ranking
        )
    }
}

extension TeamMetadata {
    func toCuratorTeam() -> CuratorTeam {
        CuratorTeam(
            team: team,
            city: city,
            division: division,
            league: league,
            logoURL: logoURL.flatMap(URL.init),
            externalURL: (espnURL ?? wikipediaURL),
            ranking: ranking,
            record: recordString
        )
    }
}
