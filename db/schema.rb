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

ActiveRecord::Schema[8.1].define(version: 2026_06_28_201938) do
  create_table "active_storage_attachments", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "record_id", null: false
    t.string "record_type", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "filename", null: false
    t.string "key", null: false
    t.text "metadata"
    t.string "service_name", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

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
    t.integer "last_event_id", default: 0, null: false
    t.datetime "last_seen_at", null: false
    t.text "location_text"
    t.string "status", default: "active", null: false
    t.datetime "updated_at", null: false
    t.index ["document_id", "agent_name"], name: "index_agent_presences_on_document_id_and_agent_name", unique: true
    t.index ["document_id"], name: "index_agent_presences_on_document_id"
  end

  create_table "cli_access_tokens", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.datetime "last_used_at"
    t.string "name", limit: 255, default: "Thinkroom CLI", null: false
    t.datetime "revoked_at"
    t.string "token_digest", limit: 64, null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["token_digest"], name: "index_cli_access_tokens_on_token_digest", unique: true
    t.index ["user_id"], name: "index_cli_access_tokens_on_user_id"
  end

  create_table "cli_device_authorizations", force: :cascade do |t|
    t.datetime "approved_at"
    t.datetime "consumed_at"
    t.datetime "created_at", null: false
    t.string "device_code_digest", limit: 64, null: false
    t.datetime "expires_at", null: false
    t.datetime "last_polled_at"
    t.datetime "updated_at", null: false
    t.string "user_code", limit: 9, null: false
    t.integer "user_id"
    t.index ["device_code_digest"], name: "index_cli_device_authorizations_on_device_code_digest", unique: true
    t.index ["expires_at"], name: "index_cli_device_authorizations_on_expires_at"
    t.index ["user_code"], name: "index_cli_device_authorizations_on_user_code", unique: true
    t.index ["user_id"], name: "index_cli_device_authorizations_on_user_id"
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

  create_table "document_assets", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.integer "document_id"
    t.datetime "expires_at", null: false
    t.datetime "updated_at", null: false
    t.string "uploader_name", limit: 255, null: false
    t.index ["document_id", "expires_at"], name: "index_document_assets_on_document_id_and_expires_at"
    t.index ["document_id"], name: "index_document_assets_on_document_id"
    t.index ["expires_at"], name: "index_document_assets_on_expires_at", where: "document_id IS NULL"
  end

  create_table "documents", force: :cascade do |t|
    t.datetime "claimed_at"
    t.string "content_format", default: "markdown", null: false
    t.text "content_markdown"
    t.integer "crdt_epoch", default: 0, null: false
    t.datetime "created_at", null: false
    t.boolean "editing_locked", default: false, null: false
    t.string "link_access", default: "edit", null: false
    t.string "owner_name", limit: 255
    t.string "owner_token"
    t.json "provenance_spans", default: []
    t.string "seed_author_kind"
    t.string "seed_author_name", limit: 255
    t.datetime "seed_claimed_at"
    t.text "seed_markdown"
    t.string "seed_state", default: "pending", null: false
    t.string "slug", null: false
    t.json "tags", default: [], null: false
    t.string "title", default: "Untitled", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id"
    t.binary "yjs_state"
    t.index ["owner_token"], name: "index_documents_on_owner_token"
    t.index ["slug"], name: "index_documents_on_slug", unique: true
    t.index ["user_id"], name: "index_documents_on_user_id"
    t.check_constraint "content_format IN ('markdown', 'html')", name: "documents_content_format"
    t.check_constraint "link_access IN ('edit', 'comment', 'view')", name: "documents_link_access_check"
    t.check_constraint "user_id IS NULL OR owner_token IS NULL", name: "documents_single_owner"
  end

  create_table "feedback_runs", force: :cascade do |t|
    t.string "client_session_id", null: false
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.string "cursor_agent_id"
    t.string "cursor_agent_url"
    t.string "cursor_branch_name"
    t.string "cursor_pr_url"
    t.string "cursor_run_id"
    t.string "cursor_status"
    t.text "error_message"
    t.string "idempotency_key"
    t.integer "launch_attempt", default: 0, null: false
    t.datetime "launched_at"
    t.text "result_text"
    t.string "status", default: "uploaded", null: false
    t.datetime "updated_at", null: false
    t.integer "user_id", null: false
    t.index ["user_id", "client_session_id"], name: "index_feedback_runs_on_user_id_and_client_session_id", unique: true
    t.index ["user_id"], name: "index_feedback_runs_on_user_id"
    t.check_constraint "status IN ('uploaded', 'running', 'finished', 'failed')", name: "feedback_runs_status_check"
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

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", limit: 320, null: false
    t.string "google_uid"
    t.string "name", limit: 255, null: false
    t.string "password_digest"
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["google_uid"], name: "index_users_on_google_uid", unique: true
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "activities", "documents"
  add_foreign_key "agent_presences", "documents"
  add_foreign_key "cli_access_tokens", "users"
  add_foreign_key "cli_device_authorizations", "users"
  add_foreign_key "comments", "documents"
  add_foreign_key "document_assets", "documents"
  add_foreign_key "documents", "users"
  add_foreign_key "feedback_runs", "users"
  add_foreign_key "suggestions", "documents"
end
