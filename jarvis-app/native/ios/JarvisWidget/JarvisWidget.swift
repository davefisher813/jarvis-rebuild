// JarvisWidget.swift
// JARVIS native seven, item 5: Home Screen widget (WidgetKit).
//
// Staged uncompiled 2026-08-15. A separate widget extension target; this
// file is its whole content. The widget renders EXACTLY what Up Next shows
// and never computes its own ranking: the app writes a JSON snapshot
// (WidgetState in src/native/bridge.ts) to the App Group container on
// every Up Next change and calls reloadTimelines. One brain, two screens.
//
// Sizes:
//   small: the single next item (task if one leads, else event).
//   medium: next task AND next event side by side.
// Deep links: every entry carries a jarvis:// URL; tapping opens the app
// on that record.
// Timeline: one entry now, plus one at each upcoming event boundary from
// state.boundaries, so the widget flips at exactly the moment the schedule
// changes instead of polling.
//
// TODO(signing): App Group group.com.bridge.jarvis needs the App Groups
// entitlement on BOTH the app target and this extension after enrollment.

import WidgetKit
import SwiftUI

// MARK: - Shared state (mirrors WidgetState in src/native/bridge.ts)

struct WidgetTaskEntry: Codable {
    let id: String
    let text: String
    let reason: String
    let url: String
}

struct WidgetEventEntry: Codable {
    let id: String
    let title: String
    let start: Double
    let end: Double
    let url: String
}

struct WidgetState: Codable {
    let writtenAt: Double
    let nextTask: WidgetTaskEntry?
    let nextEvent: WidgetEventEntry?
    let boundaries: [Double]
}

enum SharedState {
    static let appGroupId = "group.com.bridge.jarvis"
    static let fileName = "upnext.json"

    static func read() -> WidgetState? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else { return nil }
        let url = container.appendingPathComponent(fileName)
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetState.self, from: data)
    }
}

// MARK: - Timeline provider

struct UpNextEntry: TimelineEntry {
    let date: Date
    let state: WidgetState?
}

struct UpNextProvider: TimelineProvider {
    func placeholder(in context: Context) -> UpNextEntry {
        UpNextEntry(date: Date(), state: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (UpNextEntry) -> Void) {
        completion(UpNextEntry(date: Date(), state: SharedState.read()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UpNextEntry>) -> Void) {
        let state = SharedState.read()
        let now = Date()
        var entries = [UpNextEntry(date: now, state: state)]
        // An entry at each event boundary: the widget content changes at
        // exactly those moments and at no other.
        for boundaryMs in (state?.boundaries ?? []).sorted() {
            let boundary = Date(timeIntervalSince1970: boundaryMs / 1000)
            if boundary > now {
                entries.append(UpNextEntry(date: boundary, state: state))
            }
        }
        // After the last boundary the app owes a fresh snapshot; atEnd asks
        // WidgetKit to come back for one.
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

// MARK: - Views (dark shell, JARVIS DNA)

struct NextTaskView: View {
    let task: WidgetTaskEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Up Next")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(task.text)
                .font(.headline)
                .lineLimit(2)
            Text(task.reason)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

struct NextEventView: View {
    let event: WidgetEventEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Next Event")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(event.title)
                .font(.headline)
                .lineLimit(2)
            Text(Date(timeIntervalSince1970: event.start / 1000), style: .time)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Up Next")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("All clear")
                .font(.headline)
        }
    }
}

struct JarvisWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: UpNextEntry

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(2)
            .containerBackground(Color.black, for: .widget)
            .foregroundStyle(.white)
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .systemMedium:
            mediumBody
        default:
            smallBody
        }
    }

    // small: the single next item, task first when both exist.
    @ViewBuilder
    private var smallBody: some View {
        if let task = entry.state?.nextTask {
            NextTaskView(task: task)
                .widgetURL(URL(string: task.url))
        } else if let event = entry.state?.nextEvent {
            NextEventView(event: event)
                .widgetURL(URL(string: event.url))
        } else {
            EmptyStateView()
                .widgetURL(URL(string: "jarvis://upnext"))
        }
    }

    // medium: next task and next event, each its own deep link.
    @ViewBuilder
    private var mediumBody: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if let task = entry.state?.nextTask {
                    Link(destination: URL(string: task.url) ?? URL(string: "jarvis://upnext")!) {
                        NextTaskView(task: task)
                    }
                } else {
                    EmptyStateView()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Group {
                if let event = entry.state?.nextEvent {
                    Link(destination: URL(string: event.url) ?? URL(string: "jarvis://schedule")!) {
                        NextEventView(event: event)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Next Event")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text("None today")
                            .font(.headline)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Widget definition

struct JarvisWidget: Widget {
    let kind = "JarvisUpNext"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UpNextProvider()) { entry in
            JarvisWidgetView(entry: entry)
        }
        .configurationDisplayName("Up Next")
        .description("Your next task and event, straight from JARVIS.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct JarvisWidgetBundle: WidgetBundle {
    var body: some Widget {
        JarvisWidget()
    }
}
