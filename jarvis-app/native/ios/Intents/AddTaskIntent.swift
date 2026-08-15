// AddTaskIntent.swift
// JARVIS native seven, item 7a: Siri capture via App Intents.
//
// Staged uncompiled 2026-08-15. "Hey Siri, add to JARVIS" takes dictated
// text and feeds it into the existing Smart Paste pipeline. The rules:
//   - capture NEVER asks a follow-up by voice: the parameter requests its
//     value once in the same breath, and there is no disambiguation dialog
//   - low confidence does not interrogate; the pipeline saves the raw text
//     as a note instead (the same refusal Smart Paste makes on screen)
//   - the spoken confirmation is one short fragment either way
//
// Delivery: the intent appends the capture to a queue file in the App
// Group container; the app drains the queue through IntentsBridge on next
// launch or foreground, runs Smart Paste, and stamps paste provenance. The
// intent itself never parses: one pipeline, every entrance.
//
// TODO(signing): App Group entitlement (group.com.bridge.jarvis) on the
// app target; the intent runs in-process with the app extension.

import AppIntents
import Foundation

// MARK: - Capture queue (App Group JSON lines)

enum CaptureQueue {
    static let appGroupId = "group.com.bridge.jarvis"
    static let fileName = "capture-queue.json"

    struct Capture: Codable {
        let text: String
        let capturedAt: Double
    }

    static func append(_ text: String) throws {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            throw NSError(domain: "jarvis.capture", code: 1)
        }
        let url = container.appendingPathComponent(fileName)
        var queue: [Capture] = []
        if let data = try? Data(contentsOf: url),
           let existing = try? JSONDecoder().decode([Capture].self, from: data) {
            queue = existing
        }
        queue.append(Capture(text: text, capturedAt: Date().timeIntervalSince1970 * 1000))
        let data = try JSONEncoder().encode(queue)
        try data.write(to: url, options: .atomic)
    }
}

// MARK: - The intent

struct AddTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Add to JARVIS"
    static var description = IntentDescription("Capture a task by voice; JARVIS files it.")

    // The one and only ask, made inline. No follow-up questions exist in
    // this intent, by design.
    @Parameter(title: "Task", requestValueDialog: "What should JARVIS capture?")
    var text: String

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$text) to JARVIS")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .result(dialog: "Nothing captured")
        }
        try CaptureQueue.append(trimmed)
        // The Smart Paste pipeline decides task vs note when the app drains
        // the queue; Siri confirms capture, not classification, so the
        // spoken line stays honest and short.
        return .result(dialog: "Captured")
    }
}

// MARK: - Shortcuts phrase registration

struct JarvisAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddTaskIntent(),
            phrases: [
                "Add to \(.applicationName)",
                "Capture in \(.applicationName)",
                "Tell \(.applicationName)",
            ],
            shortTitle: "Add to JARVIS",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: NextUpIntent(),
            phrases: [
                "What's next in \(.applicationName)",
                "Next up in \(.applicationName)",
            ],
            shortTitle: "Next Up",
            systemImageName: "arrow.right.circle"
        )
    }
}
