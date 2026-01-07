import Foundation

// ─────────── Section Header ───────────

enum FacetExtractor {
    static func facetKeys(from coreEntity: Any?) -> [String] {
        guard let coreEntity else { return [] }
        var keys: [String] = []
        let mirror = Mirror(reflecting: coreEntity)
        
        for child in mirror.children {
            guard let label = child.label else { continue }
            guard let value = unwrapOptional(child.value) else { continue }
            if let s = value as? String {
                let v = s.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !v.isEmpty else { continue }
                if label == "name" {
                    keys.append("entity:\(v)")
                } else {
                    keys.append("\(label):\(v)")
                }
            } else if let arr = value as? [String] {
                for s in arr {
                    let v = s.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !v.isEmpty else { continue }
                    keys.append("\(label):\(v)")
                }
            }
        }
        
        if !keys.contains(where: { $0.hasPrefix("entity:") }),
           let name = value(forKey: "name", in: coreEntity) {
            keys.append("entity:\(name)")
        }
        
        var seen = Set<String>()
        var out: [String] = []
        for k in keys where seen.insert(k).inserted { out.append(k) }
        return out
    }
    
    private static func value(forKey key: String, in obj: Any) -> String? {
        if let un = unwrapOptional(obj) {
            let m = Mirror(reflecting: un)
            for c in m.children {
                if c.label == key, let s = unwrapOptional(c.value) as? String {
                    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
                    return t.isEmpty ? nil : t
                }
            }
        }
        return nil
    }
    
    private static func unwrapOptional(_ any: Any) -> Any? {
        let m = Mirror(reflecting: any)
        guard m.displayStyle == .optional else { return any }
        return m.children.first?.value
    }
}
