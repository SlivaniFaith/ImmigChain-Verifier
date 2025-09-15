;; contracts/item-issuer.clar

(define-constant ERR-UNAUTHORIZED (err u1000))
(define-constant ERR-INVALID-METADATA (err u1001))
(define-constant ERR-INVALID-ITEM-TYPE (err u1002))
(define-constant ERR-INVALID-EXPIRY (err u1003))
(define-constant ERR-INVALID-ISSUER-FEE (err u1004))
(define-constant ERR-ITEM-ALREADY-EXISTS (err u1005))
(define-constant ERR-MAX-ITEMS-EXCEEDED (err u1006))
(define-constant ERR-AUTHORITY-NOT-SET (err u1007))
(define-constant ERR-INVALID-LOCATION (err u1008))
(define-constant ERR-INVALID-CATEGORY (err u1009))
(define-constant ERR-INVALID-SERIAL (err u1010))
(define-constant ERR-EXPIRY-PAST (err u1011))
(define-constant ERR-UPDATE-NOT-ALLOWED (err u1012))
(define-constant ERR-INVALID-UPDATE (err u1013))

(define-data-var next-item-id uint u0)
(define-data-var max-items uint u5000)
(define-data-var issuer-fee uint u500)
(define-data-var authority-contract (optional principal) none)
(define-data-var default-location (string-ascii 50) "Global")

(define-map items
  uint
  {
    metadata: (string-ascii 100),
    item-type: (string-ascii 20),
    expiry: uint,
    serial: (string-ascii 50),
    location: (string-ascii 50),
    category: (string-ascii 30),
    issued-at: uint,
    issuer: principal,
    status: bool
  }
)

(define-map items-by-serial
  (string-ascii 50)
  uint
)

(define-map items-by-type
  (string-ascii 20)
  (list 100 uint)
)

(define-map item-updates
  uint
  {
    update-metadata: (string-ascii 100),
    update-expiry: uint,
    update-location: (string-ascii 50),
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-item (id uint))
  (map-get? items id)
)

(define-read-only (get-item-updates (id uint))
  (map-get? item-updates id)
)

(define-read-only (get-items-by-type (typ (string-ascii 20)))
  (map-get? items-by-type typ)
)

(define-read-only (is-item-registered (serial (string-ascii 50)))
  (is-some (map-get? items-by-serial serial))
)

(define-read-only (get-item-count)
  (ok (var-get next-item-id))
)

(define-private (validate-metadata (meta (string-ascii 100)))
  (if (and (> (len meta) u0) (<= (len meta) u100))
      (ok true)
      (err ERR-INVALID-METADATA))
)

(define-private (validate-item-type (typ (string-ascii 20)))
  (if (or (is-eq typ "passport") (is-eq typ "visa") (is-eq typ "aid-kit") (is-eq typ "document"))
      (ok true)
      (err ERR-INVALID-ITEM-TYPE))
)

(define-private (validate-expiry (exp uint))
  (if (>= exp block-height)
      (ok true)
      (err ERR-EXPIRY-PAST))
)

(define-private (validate-serial (ser (string-ascii 50)))
  (if (and (> (len ser) u0) (<= (len ser) u50))
      (ok true)
      (err ERR-INVALID-SERIAL))
)

(define-private (validate-location (loc (string-ascii 50)))
  (if (or (is-eq loc (var-get default-location)) (and (> (len loc) u0) (<= (len loc) u50)))
      (ok true)
      (err ERR-INVALID-LOCATION))
)

(define-private (validate-category (cat (string-ascii 30)))
  (if (and (> (len cat) u0) (<= (len cat) u30))
      (ok true)
      (err ERR-INVALID-CATEGORY))
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-issuer-fee (new-fee uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (asserts! (>= new-fee u0) (err ERR-INVALID-ISSUER-FEE))
    (var-set issuer-fee new-fee)
    (ok true)
  )
)

(define-public (set-max-items (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (asserts! (> new-max u0) (err ERR-INVALID-UPDATE))
    (var-set max-items new-max)
    (ok true)
  )
)

(define-public (set-default-location (new-loc (string-ascii 50)))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR-AUTHORITY-NOT-SET))
    (try! (validate-location new-loc))
    (var-set default-location new-loc)
    (ok true)
  )
)

(define-public (mint-item
  (metadata-str (string-ascii 100))
  (item-type (string-ascii 20))
  (expiry uint)
  (serial (string-ascii 50))
  (location (string-ascii 50))
  (category (string-ascii 30))
)
  (let
    (
      (next-id (var-get next-item-id))
      (current-max (var-get max-items))
      (authority (var-get authority-contract))
    )
    (asserts! (< next-id current-max) (err ERR-MAX-ITEMS-EXCEEDED))
    (try! (validate-metadata metadata-str))
    (try! (validate-item-type item-type))
    (try! (validate-expiry expiry))
    (try! (validate-serial serial))
    (try! (validate-location location))
    (try! (validate-category category))
    (asserts! (is-none (map-get? items-by-serial serial)) (err ERR-ITEM-ALREADY-EXISTS))
    (asserts! (is-some authority) (err ERR-AUTHORITY-NOT-SET))
    (let
      (
        (authority-recipient (unwrap-panic authority))
      )
      (try! (stx-transfer? (var-get issuer-fee) tx-sender authority-recipient))
    )
    (map-set items next-id
      {
        metadata: metadata-str,
        item-type: item-type,
        expiry: expiry,
        serial: serial,
        location: (default-to (var-get default-location) location),
        category: category,
        issued-at: block-height,
        issuer: tx-sender,
        status: true
      }
    )
    (map-set items-by-serial serial next-id)
    (let
      (
        (existing-types (default-to (list ) (map-get? items-by-type item-type)))
        (new-list (unwrap-panic (as-max-len? (append existing-types next-id) u100)))
      )
      (map-set items-by-type item-type new-list)
    )
    (var-set next-item-id (+ next-id u1))
    (print { event: "item-minted", id: next-id })
    (ok next-id)
  )
)

(define-public (update-item
  (item-id uint)
  (update-metadata (string-ascii 100))
  (update-expiry uint)
  (update-location (string-ascii 50))
)
  (let
    (
      (current-item (map-get? items item-id))
    )
    (match current-item
      item
        (begin
          (asserts! (is-eq (get issuer item) tx-sender) (err ERR-UNAUTHORIZED))
          (asserts! (get status item) (err ERR-UPDATE-NOT-ALLOWED))
          (try! (validate-metadata update-metadata))
          (try! (validate-expiry update-expiry))
          (try! (validate-location update-location))
          (map-set items item-id
            {
              metadata: update-metadata,
              item-type: (get item-type item),
              expiry: update-expiry,
              serial: (get serial item),
              location: update-location,
              category: (get category item),
              issued-at: (get issued-at item),
              issuer: (get issuer item),
              status: (get status item)
            }
          )
          (map-set item-updates item-id
            {
              update-metadata: update-metadata,
              update-expiry: update-expiry,
              update-location: update-location,
              update-timestamp: block-height,
              updater: tx-sender
            }
          )
          (print { event: "item-updated", id: item-id })
          (ok true)
        )
      (err ERR-INVALID-UPDATE)
    )
  )
)

(define-public (deactivate-item (item-id uint))
  (let
    (
      (current-item (map-get? items item-id))
    )
    (match current-item
      item
        (begin
          (asserts! (is-eq (get issuer item) tx-sender) (err ERR-UNAUTHORIZED))
          (map-set items item-id
            {
              metadata: (get metadata item),
              item-type: (get item-type item),
              expiry: (get expiry item),
              serial: (get serial item),
              location: (get location item),
              category: (get category item),
              issued-at: (get issued-at item),
              issuer: (get issuer item),
              status: false
            }
          )
          (print { event: "item-deactivated", id: item-id })
          (ok true)
        )
      (err ERR-INVALID-UPDATE)
    )
  )
)