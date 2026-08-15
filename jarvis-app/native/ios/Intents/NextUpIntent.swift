// NextUpIntent.swift
// JARVIS native seven, item 7b: "What's next in JARVIS" via App Intents.
//
// Staged uncompiled 2026-08-15. Speaks the SAME next item the widget and
// Up Next show, read from the App Group snapshot the app maintains
// (WidgetState, written by WidgetStateBridge). The intent never ranks and
// never reaches into the database: it reads the snapshot or says so.
//
// TODO(signing): App Group entitlement (group.com.bridge.jarvis).

import AppIntents
import Foundation

// MARK: - Snapshot reader (same file the widget reads)

private struct SnapshotTask: Codable {
    let id: String
    let text: String
    let reason: String
    let url: String
}

private struct SnapshotEvent: Codable {
    let id: String
    let title: String
    let start: Double
    let end: Double
    let url: String
}

private struct Snapshot: Codable {
    let writtenAt: Double
    let nextTask: SnapshotTask?
    let nextEvent: SnapshotEvent?
    let boundaries: [Double]
}

private enum SnapshotStore {
    static let appGroupId = "group.com.bridge.jarvis"
    static let fileName = "upnext.json"

    static func read() -> Snapshot? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else { return nil }
        let url = container.appendingPathComponent(fileName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }
}

// MARK: - The intent

struct NextUpIntent: AppIntent {
    static var title: LocalizedStringResource = "Next Up"
    static var description = IntentDescription("Hear the next thing JARVIS has for you.")

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let snapshot = SnapshotStore.read() else {
            return .result(dialog: "Open JARVIS once and I'll know")
        }
        let timeFormatter = DateFormatter()
        timeFormatter.timeStyle = .short
        // Task leads when both exist, matching the widget's small size and
        // Up Next itself. Fragments, not sentences: the app never lectures,
        // and neither does Siri on its behalf.
        if let task = snapshot.nextTask {
            let line = task.reason.isEmpty ? "Up next: \(task.text)" : "Up next: \(task.text), \(task.reason)"
            return .result(dialog: IntentDialog(stringLiteral: line))
        }
        if let event = snapshot.nextEvent {
            let start = Date(timeIntervalSince1970: event.start / 1000)
            let line = "Next event: \(event.title) at \(timeFormatter.string(from: start))"
            return .result(dialog: IntentDialog(stringLiteral: line))
        }
        return .result(dialog: "All clear")
    }
}
