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

ActiveRecord::Schema[8.1].define(version: 2026_06_05_000001) do
  create_table "documents", force: :cascade do |t|
    t.text "content_markdown"
    t.datetime "created_at", null: false
    t.json "provenance_spans", default: []
    t.text "seed_markdown"
    t.string "seed_state", default: "pending", null: false
    t.string "slug", null: false
    t.string "title", default: "Untitled", null: false
    t.datetime "updated_at", null: false
    t.binary "yjs_state"
    t.index ["slug"], name: "index_documents_on_slug", unique: true
  end
end
