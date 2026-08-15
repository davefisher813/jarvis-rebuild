// LeaveByActivity.swift
// JARVIS native seven, item 6: Leave By Live Activity (ActivityKit).
//
// Staged uncompiled 2026-08-15. A countdown to leave-by time on the lock
// screen and in the Dynamic Island, started by the app when a leave-by
// alert would fire (LiveActivityBridge in src/native/bridge.ts). The
// activity ends itself at departure time plus a grace window; the app ends
// it early when the event is cancelled or the user marks themselves gone.
//
// TODO(signing): Live Activities need NSSupportsLiveActivities YES in
// Info.plist; frequent updates are not needed (the countdown renders
// natively from the staleDate, no pushes required).

import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - Attributes (static per activity) and content state

struct LeaveByAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Epoch seconds; the views render countdowns natively from these,
        // so the activity needs no ticking updates.
        var leaveAt: Date
        var eventStart: Date
    }

    var eventId: String
    var eventTitle: String
    var destination: String
    var graceMinutes: Int
}

// MARK: - Lifecycle helper (called by the Capacitor plugin layer)

enum LeaveByActivityManager {
    @discardableResult
    static func start(
        eventId: String,
        eventTitle: String,
        destination: String,
        leaveAt: Date,
        eventStart: Date,
        graceMinutes: Int
    ) throws -> String {
        let attributes = LeaveByAttributes(
            eventId: eventId,
            eventTitle: eventTitle,
            destination: destination,
            graceMinutes: graceMinutes
        )
        let state = LeaveByAttributes.ContentState(leaveAt: leaveAt, eventStart: eventStart)
        // staleDate = departure + grace: the system dims and then removes
        // the activity on its own even when the app never comes back.
        let stale = leaveAt.addingTimeInterval(TimeInterval(graceMinutes * 60))
        let activity = try Activity.request(
            attributes: attributes,
            content: .init(state: state, staleDate: stale)
        )
        return activity.id
    }

    static func update(activityId: String, leaveAt: Date) async {
        for activity in Activity<LeaveByAttributes>.activities where activity.id == activityId {
            let state = LeaveByAttributes.ContentState(
                leaveAt: leaveAt,
                eventStart: activity.content.state.eventStart
            )
            let stale = leaveAt.addingTimeInterval(TimeInterval(activity.attributes.graceMinutes * 60))
            await activity.update(.init(state: state, staleDate: stale))
        }
    }

    static func end(activityId: String) async {
        for activity in Activity<LeaveByAttributes>.activities where activity.id == activityId {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}

// MARK: - Lock screen view + Dynamic Island

struct LeaveByLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LeaveByAttributes.self) { context in
            // Lock screen banner.
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Leave By")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(context.state.leaveAt, style: .time)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.eventTitle)
                            .font(.headline)
                            .lineLimit(1)
                        Text(context.attributes.destination)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    // Native countdown to leave-by; flips to counting up
                    // past zero, which is exactly the pressure it should be.
                    Text(context.state.leaveAt, style: .timer)
                        .font(.title2.monospacedDigit().weight(.bold))
                        .frame(maxWidth: 90, alignment: .trailing)
                }
            }
            .padding()
            .activityBackgroundTint(Color.black)
            .activitySystemActionForegroundColor(Color.white)
            .foregroundStyle(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.eventTitle)
                            .font(.headline)
                            .lineLimit(1)
                        Text(context.attributes.destination)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.leaveAt, style: .timer)
                        .font(.title3.monospacedDigit().weight(.bold))
                        .frame(maxWidth: 70, alignment: .trailing)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text("Leave by")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(context.state.leaveAt, style: .time)
                            .font(.caption.weight(.semibold))
                        Spacer()
                        Text("Starts")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(context.state.eventStart, style: .time)
                            .font(.caption.weight(.semibold))
                    }
                }
            } compactLeading: {
                Image(systemName: "figure.walk.departure")
            } compactTrailing: {
                Text(context.state.leaveAt, style: .timer)
                    .monospacedDigit()
                    .frame(maxWidth: 52)
            } minimal: {
                Image(systemName: "figure.walk.departure")
            }
            .widgetURL(URL(string: "jarvis://event/\(context.attributes.eventId)"))
        }
    }
}
