# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_06_05_000004) do
  create_table "activities", force: :cascade do |t|
    t.string "action", null: false
    t.string "actor_kind", default: "human", null: false
    t.string "actor_name", null: false
    t.datetime "created_at", null: false
    t.text "detail"
    t.integer "document_id", null: false
    t.index ["document_id", "created_at"], name: "index_activities_on_document_id_and_created_at"
    t.index ["document_id"], name: "index_activities_on_document_id"
  end

  create_table "agent_presences", force: :cascade do |t|
    t.string "agent_name", null: false
    t.datetime "created_at", null: false
    t.integer "document_id", null: false
    t.datetime "last_seen_at", null: false
    t.text "location_text"
    t.string "status", default: "active", null: false
    t.datetime "updated_at", null: false
    t.index ["document_id", "agent_name"], name: "index_agent_presences_on_document_id_and_agent_name", unique: true
    t.index ["document_id"], name: "index_agent_presences_on_document_id"
  end

  create_table "comments", force: :cascade do |t|
    t.text "anchor_text"
    t.string "author_kind", default: "human", null: false
    t.string "author_name", null: false
    t.text "body", null: false
    t.datetime "created_at", null: false
    t.integer "document_id", null: false
    t.datetime "resolved_at"
    t.datetime "updated_at", null: false
    t.index ["document_id", "resolved_at"], name: "index_comments_on_document_id_and_resolved_at"
    t.index ["document_id"], name: "index_comments_on_document_id"
  end

  create_table "documents", force: :cascade do |t|
    t.text "content_markdown"
    t.datetime "created_at", null: false
    t.json "provenance_spans", default: []
    t.datetime "seed_claimed_at"
    t.text "seed_markdown"
    t.string "seed_state", default: "pending", null: false
    t.string "slug", null: false
    t.string "title", default: "Untitled", null: false
    t.datetime "updated_at", null: false
    t.binary "yjs_state"
    t.index ["slug"], name: "index_documents_on_slug", unique: true
  end

  create_table "suggestions", force: :cascade do |t|
    t.text "anchor_text"
    t.string "author_kind", default: "ai", null: false
    t.string "author_name", null: false
    t.text "body", null: false
    t.datetime "created_at", null: false
    t.integer "document_id", null: false
    t.string "intent"
    t.text "replaces"
    t.string "resolved_by"
    t.string "status", default: "pending", null: false
    t.datetime "updated_at", null: false
    t.index ["document_id", "status"], name: "index_suggestions_on_document_id_and_status"
    t.index ["document_id"], name: "index_suggestions_on_document_id"
  end

  add_foreign_key "activities", "documents"
  add_foreign_key "agent_presences", "documents"
  add_foreign_key "comments", "documents"
  add_foreign_key "suggestions", "documents"
end
