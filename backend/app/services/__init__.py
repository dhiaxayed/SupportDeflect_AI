"""Business and infrastructure services called by HTTP routes and local workers.

Keep orchestration in the owning service; importing this package does not start
workers or implicitly expose every provider as a package-level dependency.
"""
