// ContactsPlugin.swift
// JARVIS native seven, item 3: Contacts, read only.
//
// Staged uncompiled 2026-08-15. This plugin READS the address book and
// nothing more. There is no CNSaveRequest anywhere in this file and none
// may be added: JARVIS never writes back to Contacts. Matching against
// existing people (phone/email identity, fill missing fields only, refuse
// ambiguity, never create people) is pure TypeScript in
// src/native/contactsMatch.ts.
//
// Photo bytes stay out of the initial query on purpose: thumbnails resolve
// one at a time through fetchPhoto only when a matched person is missing
// one, so the app never holds the whole address book's images in memory.
//
// TODO(signing): Info.plist needs NSContactsUsageDescription from
// native/InfoPlist-strings.md.

import Foundation
import Capacitor
import Contacts

@objc(ContactsPlugin)
public class ContactsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ContactsPlugin"
    public let jsName = "ContactsBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queryContacts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchPhoto", returnType: CAPPluginReturnPromise),
    ]

    private let store = CNContactStore()

    // MARK: - Access

    @objc func requestAccess(_ call: CAPPluginCall) {
        store.requestAccess(for: .contacts) { granted, error in
            if let error = error { call.reject("contacts access failed", nil, error); return }
            call.resolve(["granted": granted])
        }
    }

    // MARK: - Read (identity fields only)

    @objc func queryContacts(_ call: CAPPluginCall) {
        let keys: [CNKeyDescriptor] = [
            CNContactIdentifierKey as CNKeyDescriptor,
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor,
            CNContactImageDataAvailableKey as CNKeyDescriptor,
        ]
        let request = CNContactFetchRequest(keysToFetch: keys)
        var contacts: [[String: Any]] = []
        do {
            try store.enumerateContacts(with: request) { contact, _ in
                var record: [String: Any] = [
                    "id": contact.identifier,
                    "phones": contact.phoneNumbers.map { $0.value.stringValue },
                    "emails": contact.emailAddresses.map { String($0.value) },
                ]
                if !contact.givenName.isEmpty { record["givenName"] = contact.givenName }
                if !contact.familyName.isEmpty { record["familyName"] = contact.familyName }
                if contact.imageDataAvailable { record["photoRef"] = contact.identifier }
                contacts.append(record)
            }
            call.resolve(["contacts": contacts])
        } catch {
            call.reject("contacts query failed", nil, error)
        }
    }

    // MARK: - Photo (on demand, one thumbnail at a time)

    @objc func fetchPhoto(_ call: CAPPluginCall) {
        guard let photoRef = call.getString("photoRef") else {
            call.reject("missing photoRef")
            return
        }
        let keys: [CNKeyDescriptor] = [CNContactThumbnailImageDataKey as CNKeyDescriptor]
        do {
            let contact = try store.unifiedContact(withIdentifier: photoRef, keysToFetch: keys)
            if let data = contact.thumbnailImageData {
                call.resolve(["base64": data.base64EncodedString()])
            } else {
                call.resolve(["base64": NSNull()])
            }
        } catch {
            call.reject("photo fetch failed", nil, error)
        }
    }
}
