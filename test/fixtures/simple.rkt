#lang racket

(require racket/string)

(define greeting "hello")

;; A function with contract
(define (add x y)
  (+ x y))

(define (process items)
  (let ([filtered (filter number? items)]
        [re #rx"\\d+"])
    (map add1 filtered)))

;; Character literal test
(define space-char #\space)
(define paren-char #\()
